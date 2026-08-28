import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/access'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { trimMessages } from '@/lib/agent/trim-messages'
import { buildAssistantTools } from '@/lib/admin/assistant-tools'
import { buildAssistantPrompt } from '@/lib/admin/assistant-prompt'

// Node runtime: Supabase service client + Anthropic.
export const runtime = 'nodejs'

const MAX_PER_HOUR = 40

// Home-page natural-language assistant. Answers operator questions and offers
// navigation via tools. Scope is derived from the authenticated user only — this
// route takes NO client-supplied ids, and every tool re-checks access.
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const allowed = await checkRateLimit(`admin-assistant:${user.id}`, MAX_PER_HOUR, 60 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json(
      { error: 'You have reached the limit — please wait a bit before asking again.' },
      { status: 429 }
    )
  }

  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: buildAssistantPrompt(user),
    messages: await convertToModelMessages(trimMessages(messages)),
    tools: await buildAssistantTools(user),
    stopWhen: stepCountIs(6),
    onFinish: async ({ totalUsage }) => {
      try {
        await recordTokenUsage({
          task: 'onboarding',
          stage: 'oneoff',
          model: 'claude-sonnet-4-6',
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
        })
      } catch (err) {
        console.error('[admin-assistant] onFinish failed:', err)
      }
    },
  })

  return result.toUIMessageStreamResponse({
    onError: () => 'The assistant hit an error — please try again.',
  })
}
