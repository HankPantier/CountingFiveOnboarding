import { streamText, convertToModelMessages, stepCountIs, type UIMessage, type TextUIPart } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { requireAuditAccess } from '@/lib/auth/access'
import { buildAuditEditPrompt } from '@/lib/audit/edit-prompt'
import { applyAuditEdit } from '@/lib/audit/apply-edit'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { trimMessages } from '@/lib/agent/trim-messages'
import type { AuditResult } from '@/types/audit-result'
import { z } from 'zod'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_MESSAGES_PER_HOUR = 60

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid audit id' }, { status: 400 })
  }

  // Admins and the auditor who owns this audit.
  const auth = await requireAuditAccess(id)
  if (auth instanceof NextResponse) return auth

  const { messages }: { messages: UIMessage[] } = await req.json()
  const supabase = createServerClient()

  const { data: run, error } = await supabase
    .from('audit_runs')
    .select('audit_status, result, session_id')
    .eq('id', id)
    .single()
  if (error || !run) {
    return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  }
  if (run.audit_status !== 'complete' || !run.result) {
    return NextResponse.json({ error: 'Audit is not complete' }, { status: 409 })
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recentCount } = await supabase
    .from('audit_messages')
    .select('id', { count: 'exact', head: true })
    .eq('audit_run_id', id)
    .eq('role', 'user')
    .gte('created_at', hourAgo)
  if ((recentCount ?? 0) >= MAX_MESSAGES_PER_HOUR) {
    return NextResponse.json(
      { error: 'Message limit reached — please wait a bit before continuing.' },
      { status: 429 }
    )
  }

  // No `processing` lock: that belongs to the onboarding chat. useChat
  // serializes per user, which is enough for an admin tool.
  const lastMsg = messages[messages.length - 1]
  if (lastMsg?.role === 'user') {
    const textPart = lastMsg.parts.find((p): p is TextUIPart => p.type === 'text')
    const userText = textPart?.text ?? ''
    if (userText && userText !== '__init__') {
      await supabase.from('audit_messages').insert({ audit_run_id: id, role: 'user', content: userText })
    }
  }

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: buildAuditEditPrompt(run.result as unknown as AuditResult),
    messages: await convertToModelMessages(trimMessages(messages)),
    tools: {
      edit_audit: {
        description: 'Edit the AI intelligence sections of the audit report. Paths must start with intelligence.',
        inputSchema: z.object({
          updates: z
            .record(z.string(), z.unknown())
            .describe('Dotted path under intelligence.* → value to set (e.g. intelligence.niche_services.commentary)'),
        }),
        execute: async ({ updates }) => applyAuditEdit(supabase, id, updates),
      },
    },
    stopWhen: stepCountIs(5),
    onFinish: async ({ text, totalUsage }) => {
      try {
        await recordTokenUsage({
          task: 'audit',
          auditId: id,
          sessionId: run.session_id,
          stage: 'audit_edit',
          model: 'claude-sonnet-4-6',
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
        })
        if (text) {
          await supabase.from('audit_messages').insert({ audit_run_id: id, role: 'assistant', content: text })
        }
      } catch (err) {
        console.error('[audit-chat] onFinish failed:', err)
      }
    },
  })

  return result.toUIMessageStreamResponse({
    onError: () => 'The assistant hit an error — please try again.',
  })
}
