import { streamText, convertToModelMessages, stepCountIs, type UIMessage, type TextUIPart } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { buildSystemPrompt } from '@/lib/agent/system-prompt'
import { trimMessages } from '@/lib/agent/trim-messages'
import { deepMerge } from '@/lib/mbp/schema-write'
import { runWhoisLookup } from '@/lib/whois/lookup'
import { z } from 'zod'
import { NextResponse } from 'next/server'
import type { Database, Json } from '@/types/database'
import type { GapItem } from '@/types/gap-item'

type Session = Database['public']['Tables']['sessions']['Row']
type Supabase = ReturnType<typeof createServerClient>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Per-session abuse cap: the processing flag serializes concurrent calls, but
// nothing bounded sequential volume — a leaked session URL could drain the
// Anthropic budget. 60 user messages/hour is far above any real conversation.
const MAX_MESSAGES_PER_HOUR = 60

export async function POST(req: Request) {
  const { messages, sessionId }: { messages: UIMessage[]; sessionId: string } = await req.json()

  if (!sessionId || !UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: session, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (error || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recentCount } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('role', 'user')
    .gte('created_at', hourAgo)

  if ((recentCount ?? 0) >= MAX_MESSAGES_PER_HOUR) {
    return NextResponse.json(
      { error: 'Message limit reached — please wait a bit before continuing.' },
      { status: 429 }
    )
  }

  // Atomic lock: only set processing=true if it's currently false
  const { data: lockResult } = await supabase
    .from('sessions')
    .update({ processing: true })
    .eq('id', sessionId)
    .eq('processing', false)
    .select('id')

  if (!lockResult?.length) {
    return NextResponse.json({ error: 'Already processing' }, { status: 429 })
  }

  // Save incoming user message — skip the __init__ trigger
  const lastMsg = messages[messages.length - 1]
  if (lastMsg?.role === 'user') {
    const textPart = lastMsg.parts.find((p): p is TextUIPart => p.type === 'text')
    const userText = textPart?.text ?? ''
    if (userText && userText !== '__init__') {
      await supabase.from('messages').insert({
        session_id: sessionId,
        role: 'user',
        content: userText,
      })
    }
  }

  try {
    const systemPrompt = buildSystemPrompt(session)
    const trimmed = trimMessages(messages)
    const modelMessages = await convertToModelMessages(trimmed)

    const modelName = [3, 4].includes(session.current_phase) ? 'sonnet' : 'haiku'
    const model = modelName === 'sonnet'
      ? anthropic('claude-sonnet-4-6')
      : anthropic('claude-haiku-4-5-20251001')

    console.warn(
      `[model] phase=${session.current_phase} model=${modelName}`,
      `[messages] raw=${messages.length} trimmed=${trimmed.length}`,
      `[system-prompt] chars=${systemPrompt.length}`
    )

    // Soft guard: CLAUDE.md targets ~1k–3.5k input tokens depending on
    // phase, with 5k as the "stop and investigate" threshold. We can't
    // count Anthropic-correct tokens without the tokenizer, so a chars/4
    // estimate is good enough for an alert.
    const estimatedTokens = Math.ceil(systemPrompt.length / 4)
    if (estimatedTokens > 5000) {
      console.error(
        `[token-budget] EXCEEDED phase=${session.current_phase} ` +
          `estimated=${estimatedTokens} chars=${systemPrompt.length}`
      )
    }

    const result = streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
      tools: {
        update_session_data: {
          description: 'Update collected session fields and advance phase state.',
          inputSchema: z.object({
            updates: z
              .record(z.string(), z.unknown())
              .describe('Field path → value pairs to merge into schema_data'),
            resolvedGaps: z
              .array(z.string())
              .optional()
              .describe('Gap field paths now resolved'),
            advancePhase: z
              .boolean()
              .optional()
              .describe('Set true only when current phase goals are fully complete'),
          }),
          execute: async ({ updates, resolvedGaps, advancePhase }) => {
            const result = await updateSessionSchema(
              supabase, sessionId, session, updates, resolvedGaps, advancePhase
            )
            return result
          },
        },
      },
      stopWhen: stepCountIs(5),
      onFinish: async ({ text, totalUsage }) => {
        try {
          console.warn(
            `[tokens] session=${sessionId} input=${totalUsage.inputTokens} output=${totalUsage.outputTokens}`
          )
          if (text) {
            await supabase.from('messages').insert({
              session_id: sessionId,
              role: 'assistant',
              content: text,
            })
          }
          await supabase
            .from('sessions')
            .update({ last_activity_at: new Date().toISOString(), processing: false })
            .eq('id', sessionId)
        } catch (err) {
          console.error('[chat] onFinish failed:', err)
          try {
            await supabase.from('sessions').update({ processing: false }).eq('id', sessionId)
          } catch { /* best effort */ }
        }
      },
    })

    return result.toUIMessageStreamResponse()
  } catch (err) {
    await supabase.from('sessions').update({ processing: false }).eq('id', sessionId)
    throw err
  }
}

async function updateSessionSchema(
  supabase: Supabase,
  sessionId: string,
  originalSession: Session,
  updates: Record<string, unknown>,
  resolvedGaps?: string[],
  advancePhase?: boolean
): Promise<{ success: boolean; phaseAdvanced?: boolean; blocked?: string }> {
  // Reload for latest state (multi-step tool calls)
  const { data: current } = await supabase
    .from('sessions')
    .select('schema_data, gap_list, current_phase, status, website_url')
    .eq('id', sessionId)
    .single()

  const currentSchema = (current?.schema_data as Record<string, unknown>) ?? {}
  const mergedSchema = deepMerge(currentSchema, updates)

  const currentGaps = (current?.gap_list as GapItem[]) ?? []
  const updatedGaps = resolvedGaps
    ? currentGaps.map(g => (resolvedGaps.includes(g.field) ? { ...g, resolved: true } : g))
    : currentGaps

  const currentPhase = current?.current_phase ?? 0
  let newPhase = currentPhase

  if (advancePhase) {
    const validationError = validatePhaseAdvance(currentPhase, mergedSchema, updatedGaps)
    if (validationError) {
      console.warn(`[phase-advance] Blocked phase ${currentPhase}→${currentPhase + 1}: ${validationError}`)
      // Don't advance — Claude will try again next exchange
    } else {
      newPhase = Math.min(currentPhase + 1, 7)
    }
  }

  await supabase
    .from('sessions')
    .update({
      schema_data: mergedSchema as Json,
      gap_list: updatedGaps as Json,
      current_phase: newPhase,
      status: statusForPhase(newPhase),
      completed_at: newPhase === 7 ? new Date().toISOString() : undefined,
    })
    .eq('id', sessionId)

  // Trigger WHOIS automatically when advancing to Phase 2
  if (newPhase === 2) {
    const domain =
      (mergedSchema.websiteUrl as string) ??
      (current?.website_url as string) ??
      (originalSession.website_url as string)

    if (domain) {
      // Fire and forget — WHOIS will advance the session to Phase 3 when done
      runWhoisLookup(sessionId, domain).catch(err =>
        console.error('[WHOIS trigger] Failed:', err)
      )
    } else {
      // No domain — skip WHOIS and advance directly to Phase 3
      await supabase
        .from('sessions')
        .update({ current_phase: 3, status: 'in_progress' })
        .eq('id', sessionId)
    }
  }

  return { success: true, phaseAdvanced: newPhase > currentPhase }
}

function validatePhaseAdvance(
  currentPhase: number,
  schema: Record<string, unknown>,
  gaps: GapItem[]
): string | null {
  switch (currentPhase) {
    case 1: {
      const contact = schema.contact as Record<string, string> | undefined
      if (!contact?.email) return 'contact.email is missing'
      if (!contact?.firstName) return 'contact.firstName is missing'
      if (!contact?.phone) return 'contact.phone is missing'
      if (!schema.websiteUrl) return 'websiteUrl is missing'
      return null
    }
    case 2: {
      return 'Phase 2 advances automatically after WHOIS completes — never set advancePhase on Phase 2'
    }
    case 3: {
      const meta = schema._meta as Record<string, unknown> | undefined
      const chunks = (meta?.phase3_completed_chunks as string[]) ?? []
      if (!chunks.includes('chunk1')) return 'Phase 3 chunk1 not complete'
      // Legacy sessions wrote a single "chunk2" marker before the chunk2a/2b
      // split. Either form is accepted.
      const legacyChunk2 = chunks.includes('chunk2')
      if (!legacyChunk2 && !chunks.includes('chunk2a')) return 'Phase 3 chunk2a not complete'
      if (!legacyChunk2 && !chunks.includes('chunk2b')) return 'Phase 3 chunk2b not complete'

      // chunk3 — team photos. Required when team[] is non-empty so the agent
      // can't skip past the per-member upload step. Empty team → no photos to
      // collect → chunk3 is vacuous and the agent marks it complete inline.
      const team = (schema.team as Array<unknown> | undefined) ?? []
      if (team.length > 0 && !chunks.includes('chunk3')) {
        return 'Phase 3 chunk3 (team photos) not complete'
      }

      const culture = schema.culture as Record<string, unknown> | undefined
      const business = schema.business as Record<string, unknown> | undefined
      const li = culture?.linkedIn as { url?: unknown; usefulness?: unknown } | undefined
      const gbp = business?.googleBusinessProfile as { url?: unknown; usefulness?: unknown } | undefined

      if (!li || li.url === undefined) return 'culture.linkedIn.url not captured'
      if (!gbp || gbp.url === undefined) return 'business.googleBusinessProfile.url not captured'
      // If the asset exists (non-empty URL), require a usefulness rating too.
      if (typeof li.url === 'string' && li.url && !li.usefulness) return 'culture.linkedIn.usefulness not captured'
      if (typeof gbp.url === 'string' && gbp.url && !gbp.usefulness) return 'business.googleBusinessProfile.usefulness not captured'
      return null
    }
    case 4: {
      const tier1Unresolved = gaps.filter(g => g.tier === 1 && !g.resolved)
      if (tier1Unresolved.length > 0) {
        return `${tier1Unresolved.length} Tier 1 gap(s) still unresolved`
      }
      return null
    }
    default:
      return null
  }
}

function statusForPhase(phase: number): string {
  if (phase === 0) return 'pending'
  if (phase === 7) return 'completed'
  return 'in_progress'
}
