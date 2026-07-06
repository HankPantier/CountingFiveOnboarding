import { streamText, convertToModelMessages, stepCountIs, type UIMessage, type TextUIPart } from 'ai'
import { after } from 'next/server'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { buildSystemPrompt } from '@/lib/agent/system-prompt'
import { trimMessages } from '@/lib/agent/trim-messages'
import { deepMerge, isPathFilled } from '@/lib/mbp/schema-write'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { runWhoisLookup } from '@/lib/whois/lookup'
import { asJson } from '@/lib/supabase/json-typed'
import { z } from 'zod'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/database'
import type { GapItem } from '@/types/gap-item'

type Session = Database['public']['Tables']['sessions']['Row']
type Supabase = ReturnType<typeof createServerClient>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Per-phase input-token targets from CLAUDE.md, checked against ACTUAL usage in
// onFinish (the request-time chars/4 estimate only catches the 5k hard ceiling).
const PHASE_INPUT_BUDGET: Record<number, number> = { 1: 1000, 2: 1000, 3: 3500, 4: 3000, 5: 1500, 6: 1500 }

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

  // Explicit columns: this runs on every chat turn, and '*' dragged the large
  // mbp_content text + unused fields across the wire each time.
  const { data: session, error } = await supabase
    .from('sessions')
    .select('id, current_phase, schema_data, gap_list, website_url, processing, status')
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

  // Atomic lock: only set processing=true if it's currently false. We stamp
  // last_activity_at on acquire so a lock can be aged out — a run that died
  // mid-stream never reaches onFinish to clear the flag.
  const nowIso = new Date().toISOString()
  const { data: lockResult } = await supabase
    .from('sessions')
    .update({ processing: true, last_activity_at: nowIso })
    .eq('id', sessionId)
    .eq('processing', false)
    .select('id')

  let acquired = !!lockResult?.length
  if (!acquired) {
    // Self-heal a stuck lock: reclaim only if it's been "processing" with no
    // activity for >3 min (a real in-flight run updates within maxDuration).
    // The .lt guard makes this atomic — concurrent reclaims can't both win.
    const staleBefore = new Date(Date.now() - 3 * 60 * 1000).toISOString()
    const { data: reclaimed } = await supabase
      .from('sessions')
      .update({ processing: true, last_activity_at: nowIso })
      .eq('id', sessionId)
      .eq('processing', true)
      .lt('last_activity_at', staleBefore)
      .select('id')
    acquired = !!reclaimed?.length
  }
  if (!acquired) {
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
    const messageChars = trimmed.reduce(
      (acc, m) =>
        acc +
        m.parts.reduce((n, p) => n + (p.type === 'text' ? p.text.length : 0), 0),
      0
    )
    const estimatedTokens = Math.ceil((systemPrompt.length + messageChars) / 4)
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
      // Client disconnect mid-stream fires onAbort, not onFinish — without this
      // the session stays locked until the 3-minute stale-lock reclaim.
      onAbort: async () => {
        try {
          await supabase.from('sessions').update({ processing: false }).eq('id', sessionId)
        } catch (err) {
          console.error('[chat] onAbort unlock failed:', err)
        }
      },
      onFinish: async ({ text, totalUsage }) => {
        try {
          console.warn(
            `[tokens] session=${sessionId} input=${totalUsage.inputTokens} output=${totalUsage.outputTokens}`
          )
          const budget = PHASE_INPUT_BUDGET[session.current_phase]
          if (budget && typeof totalUsage.inputTokens === 'number' && totalUsage.inputTokens > budget) {
            console.error(
              `[token-budget] phase=${session.current_phase} input=${totalUsage.inputTokens} exceeds target=${budget}`
            )
          }
          await recordTokenUsage({
            task: 'onboarding',
            sessionId,
            stage: 'onboarding',
            model: modelName === 'sonnet' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
          })
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
  originalSession: Pick<Session, 'website_url'>,
  updates: Record<string, unknown>,
  resolvedGaps?: string[],
  advancePhase?: boolean
): Promise<{ success: boolean; phaseAdvanced: boolean; blocked?: string }> {
  // Reload for latest state (multi-step tool calls)
  const { data: current } = await supabase
    .from('sessions')
    .select('schema_data, gap_list, current_phase, status, website_url')
    .eq('id', sessionId)
    .single()

  const currentSchema = (current?.schema_data as Record<string, unknown>) ?? {}
  const mergedSchema = deepMerge(currentSchema, updates)

  // The authoritative website URL lives in the `website_url` column, not in
  // schema_data. The phase-1 client agent collects contact info but never sets
  // schema.websiteUrl, so backfill it from the column — otherwise the phase-1
  // advance is silently blocked (and WHOIS below has no domain to look up).
  if (!mergedSchema.websiteUrl) {
    const columnUrl = current?.website_url ?? originalSession.website_url
    if (columnUrl) mergedSchema.websiteUrl = columnUrl
  }

  const currentGaps = (current?.gap_list as GapItem[]) ?? []
  const explicit = new Set(resolvedGaps ?? [])
  // Resolve a gap when the model explicitly says so OR when its field is now
  // filled in the merged schema. The field-filled path is robust to the model
  // not echoing the exact gap path — notably positional niche paths
  // (niches[2].painPoints) that drift if niches are reordered mid-chat.
  const updatedGaps = currentGaps.map(g =>
    g.resolved || explicit.has(g.field) || isPathFilled(mergedSchema, g.field)
      ? { ...g, resolved: true }
      : g
  )

  const currentPhase = current?.current_phase ?? 0
  let newPhase = currentPhase
  let blocked: string | undefined

  if (advancePhase) {
    const validationError = validatePhaseAdvance(currentPhase, mergedSchema, updatedGaps)
    if (validationError) {
      console.warn(`[phase-advance] Blocked phase ${currentPhase}→${currentPhase + 1}: ${validationError}`)
      // Don't advance — return the reason so the model knows it did NOT advance
      // and what's still missing (internal tool result; never surfaced to the client).
      blocked = validationError
    } else {
      newPhase = Math.min(currentPhase + 1, 7)
    }
  }

  await supabase
    .from('sessions')
    .update({
      schema_data: asJson(mergedSchema),
      gap_list: asJson(updatedGaps),
      current_phase: newPhase,
      status: statusForPhase(newPhase),
      completed_at: newPhase === 7 ? new Date().toISOString() : undefined,
    })
    .eq('id', sessionId)

  // Trigger WHOIS automatically when ADVANCING to Phase 2. Guarding on the
  // transition (not just newPhase === 2) prevents re-dispatching a lookup every
  // time the model writes incidental fields while the session sits at phase 2.
  if (newPhase === 2 && currentPhase < 2) {
    const domain =
      (mergedSchema.websiteUrl as string) ??
      (current?.website_url as string) ??
      (originalSession.website_url as string)

    if (domain) {
      // after() runs the lookup post-response but within maxDuration — a bare
      // fire-and-forget can be frozen/killed once the response returns on
      // serverless, stranding the session at Phase 2. The cron sweep is the
      // backstop for any that still don't complete.
      after(() =>
        runWhoisLookup(sessionId, domain).catch(err =>
          console.error('[WHOIS trigger] Failed:', err)
        )
      )
    } else {
      // No domain — skip WHOIS and advance directly to Phase 3
      await supabase
        .from('sessions')
        .update({ current_phase: 3, status: 'in_progress' })
        .eq('id', sessionId)
    }
  }

  return { success: true, phaseAdvanced: newPhase > currentPhase, blocked }
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

      // "Captured" = a real URL (non-empty string) OR an explicit null meaning
      // "no profile". An empty string is treated as not-yet-captured so the
      // agent can't silently skip the usefulness rating for a profile that exists.
      const captured = (a: { url?: unknown } | undefined) =>
        !!a && (a.url === null || (typeof a.url === 'string' && a.url.trim() !== ''))
      if (!captured(li)) return 'culture.linkedIn.url not captured (use null when the firm has no LinkedIn)'
      if (!captured(gbp)) return 'business.googleBusinessProfile.url not captured (use null when there is no Google Business Profile)'
      // If the asset exists (non-empty URL), require a usefulness rating too.
      if (typeof li!.url === 'string' && li!.url.trim() && !li!.usefulness) return 'culture.linkedIn.usefulness not captured'
      if (typeof gbp!.url === 'string' && gbp!.url.trim() && !gbp!.usefulness) return 'business.googleBusinessProfile.usefulness not captured'
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
