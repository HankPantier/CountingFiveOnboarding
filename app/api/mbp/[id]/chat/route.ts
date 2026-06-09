import { streamText, convertToModelMessages, stepCountIs, type UIMessage, type TextUIPart } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { buildMbpEditPrompt } from '@/lib/mbp/edit-prompt'
import { applyMbpUpdate } from '@/lib/mbp/apply-update'
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
    .select('*')
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

  // Atomic lock shared with the onboarding chat: only one Claude call per session.
  const { data: lockResult } = await supabase
    .from('sessions')
    .update({ processing: true })
    .eq('id', id)
    .eq('processing', false)
    .select('id')
  if (!lockResult?.length) {
    return NextResponse.json({ error: 'Already processing' }, { status: 429 })
  }

  const lastMsg = messages[messages.length - 1]
  if (lastMsg?.role === 'user') {
    const textPart = lastMsg.parts.find((p): p is TextUIPart => p.type === 'text')
    const userText = textPart?.text ?? ''
    if (userText && userText !== '__init__') {
      await supabase.from('mbp_messages').insert({ session_id: id, role: 'user', content: userText })
    }
  }

  try {
    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: buildMbpEditPrompt(session),
      messages: await convertToModelMessages(trimMessages(messages)),
      tools: {
        update_mbp: {
          description: 'Update MBP fields directly. Use to fill missing fields or correct existing ones.',
          inputSchema: z.object({
            updates: z
              .record(z.string(), z.unknown())
              .describe('Dotted field path → value pairs to merge into the MBP (e.g. business.tagline)'),
            resolvedGaps: z
              .array(z.string())
              .optional()
              .describe('Gap field paths now resolved'),
          }),
          execute: async ({ updates, resolvedGaps }) =>
            applyMbpUpdate(supabase, id, updates, resolvedGaps),
        },
      },
      stopWhen: stepCountIs(5),
      onFinish: async ({ text }) => {
        try {
          if (text) {
            await supabase.from('mbp_messages').insert({ session_id: id, role: 'assistant', content: text })
          }
          await supabase
            .from('sessions')
            .update({ processing: false, last_activity_at: new Date().toISOString() })
            .eq('id', id)
        } catch (err) {
          console.error('[mbp-chat] onFinish failed:', err)
          try {
            await supabase.from('sessions').update({ processing: false }).eq('id', id)
          } catch { /* best effort */ }
        }
      },
    })

    return result.toUIMessageStreamResponse()
  } catch (err) {
    await supabase.from('sessions').update({ processing: false }).eq('id', id)
    throw err
  }
}
