import { streamText, convertToModelMessages, stepCountIs, type UIMessage, type TextUIPart } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { buildMbpEditPrompt } from '@/lib/mbp/edit-prompt'
import { insertMbpSuggestion } from '@/lib/mbp/create-suggestion'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { trimMessages } from '@/lib/agent/trim-messages'
import { logAndFormatAiStreamError } from '@/lib/ai/ai-error'
import { z } from 'zod'
import { NextResponse } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_MESSAGES_PER_HOUR = 60

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  // Admins + assigned managers pass the session gate, but only admins may edit.
  const auth = await requireSessionAccess(id)
  if (auth instanceof NextResponse) return auth
  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { messages }: { messages: UIMessage[] } = await req.json()
  const supabase = createServerClient()

  const { data: session, error } = await supabase
    .from('sessions')
    .select('id, schema_data, gap_list')
    .eq('id', id)
    .single()
  if (error || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recentCount } = await supabase
    .from('mbp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', id)
    .eq('role', 'user')
    .gte('created_at', hourAgo)
  if ((recentCount ?? 0) >= MAX_MESSAGES_PER_HOUR) {
    return NextResponse.json(
      { error: 'Message limit reached — please wait a bit before continuing.' },
      { status: 429 }
    )
  }

  // NOTE: this admin tool does NOT take the client `processing` lock — that
  // belongs to the onboarding chat, and sharing it let a client conversation
  // (or a stuck flag) block admin edits. useChat serializes per user.
  const lastMsg = messages[messages.length - 1]
  if (lastMsg?.role === 'user') {
    const textPart = lastMsg.parts.find((p): p is TextUIPart => p.type === 'text')
    const userText = textPart?.text ?? ''
    if (userText && userText !== '__init__') {
      await supabase.from('mbp_messages').insert({ session_id: id, role: 'user', content: userText })
    }
  }

  // The chat NEVER mutates schema_data. It files pending suggestions that an
  // admin approves from the "Suggested updates" panel — a human check before
  // anything reaches the MBP (mirrors the content-assistant suggest flow).
  const currentSchema = (session.schema_data as Record<string, unknown>) ?? {}
  const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: buildMbpEditPrompt(session),
      messages: await convertToModelMessages(trimMessages(messages)),
      tools: {
        suggest_mbp_update: {
          description:
            'Queue a pending MBP suggestion for the admin to approve. Use when the admin confirms a value to fill or correct. Does NOT change the profile — the admin approves it in the Suggested updates panel.',
          inputSchema: z.object({
            summary: z.string().describe('One-line summary of what should change'),
            changes: z
              .array(
                z.object({
                  fieldPath: z
                    .string()
                    .describe('Dotted MBP field path, e.g. business.tagline or team.0.certifications'),
                  op: z
                    .enum(['set', 'append'])
                    .optional()
                    .describe("'set' replaces the field; 'append' adds a new array entry (team/services/niches/locations)"),
                  proposedValue: z.unknown().describe('The new value (or array item for append)'),
                  rationale: z.string().describe('Why this change is warranted'),
                })
              )
              .min(1),
          }),
          execute: async ({ summary, changes }) =>
            insertMbpSuggestion(supabase, {
              sessionId: id,
              origin: 'mbp_chat',
              summary,
              changes,
              schema: currentSchema,
            }),
        },
      },
      stopWhen: stepCountIs(5),
      onFinish: async ({ text, totalUsage }) => {
        try {
          await recordTokenUsage({
            task: 'onboarding',
            sessionId: id,
            createdBy: auth.user.id,
            stage: 'mbp_edit',
            model: 'claude-sonnet-4-6',
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
          })
          if (text) {
            await supabase.from('mbp_messages').insert({ session_id: id, role: 'assistant', content: text })
          }
          await supabase
            .from('sessions')
            .update({ last_activity_at: new Date().toISOString() })
            .eq('id', id)
        } catch (err) {
          console.error('[mbp-chat] onFinish failed:', err)
        }
      },
  })

  return result.toUIMessageStreamResponse({
    onError: (error) => logAndFormatAiStreamError('mbp-chat', error),
  })
}
