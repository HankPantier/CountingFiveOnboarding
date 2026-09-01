import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { buildGenerateContentPrompt } from '@/lib/content/generate-content-prompt'
import { insertMbpSuggestion } from '@/lib/mbp/create-suggestion'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { trimMessages } from '@/lib/agent/trim-messages'
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

  // Admins + assigned managers may generate content for their client.
  const auth = await requireSessionAccess(id)
  if (auth instanceof NextResponse) return auth

  // Content is ephemeral (no message table to count against), so throttle via
  // the shared DB-backed limiter. Fails open on limiter errors.
  const allowed = await checkRateLimit(`content-assistant:${id}`, MAX_MESSAGES_PER_HOUR, 60 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Message limit reached — please wait a bit before continuing.' },
      { status: 429 }
    )
  }

  const { messages }: { messages: UIMessage[] } = await req.json()
  const supabase = createServerClient()

  // Never select mbp_content — only the parsed schema_data reaches Claude.
  const { data: session, error } = await supabase
    .from('sessions')
    .select('id, schema_data')
    .eq('id', id)
    .single()
  if (error || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const schema = (session.schema_data as Record<string, unknown>) ?? {}

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: buildGenerateContentPrompt(session),
    messages: await convertToModelMessages(trimMessages(messages)),
    tools: {
      suggest_mbp_update: {
        description:
          'Queue a pending MBP suggestion (for admin review) when the conversation surfaces a durable, verifiable fact about the firm or team not already in the profile. Does NOT change the profile.',
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
                  .describe("'set' replaces the field; 'append' adds a new array entry"),
                proposedValue: z.unknown().describe('The new value (or array item for append)'),
                rationale: z.string().describe('Why this change is warranted'),
              })
            )
            .min(1),
        }),
        execute: async ({ summary, changes }) =>
          insertMbpSuggestion(supabase, {
            sessionId: id,
            origin: 'generate_content',
            summary,
            changes,
            schema,
          }),
      },
    },
    stopWhen: stepCountIs(5),
    onFinish: async ({ totalUsage }) => {
      try {
        await recordTokenUsage({
          task: 'onboarding',
          sessionId: id,
          createdBy: auth.user.id,
          stage: 'content_assistant',
          model: 'claude-sonnet-4-6',
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
        })
        await supabase
          .from('sessions')
          .update({ last_activity_at: new Date().toISOString() })
          .eq('id', id)
      } catch (err) {
        console.error('[content-assistant] onFinish failed:', err)
      }
    },
  })

  return result.toUIMessageStreamResponse({
    onError: () => 'The assistant hit an error — please try again.',
  })
}
