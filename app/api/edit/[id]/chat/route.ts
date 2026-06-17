import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveEditContext } from '../_helpers'
import { safePath } from '../_path'
import { getCurrentUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { trimMessages } from '@/lib/agent/trim-messages'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { buildBrandVoiceBlock, buildFirmContext } from '@/lib/content/brand-voice'
import { reviewContentEdit } from '@/lib/content/content-edit-review'
import {
  DRAFT_BRANCH,
  ensureDraftBranch,
  readFile,
  writeFile,
  FileNotFoundError,
} from '@/lib/github/repo-files'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
export const maxDuration = 120

// The agent only edits markdown content files (not nav.json/config/social).
const EDITABLE = ['content/pages/', 'content/posts/']

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  // resolveEditContext allows assigned managers; the AI editor is admin-only.
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { messages, path: rawPath }: { messages: UIMessage[]; path?: string } = await req.json()
  const path = rawPath ? safePath(rawPath) : null
  if (!path || !EDITABLE.some(p => path.startsWith(p))) {
    return NextResponse.json({ error: 'Open a page or post to edit with AI' }, { status: 400 })
  }

  const supabase = createServerClient()

  let currentContent: string
  try {
    await ensureDraftBranch(ctx.githubRepo)
    currentContent = (await readFile(ctx.githubRepo, path, DRAFT_BRANCH)).content
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    throw err
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', ctx.sessionId)
    .single()
  const schema = (session?.schema_data ?? {}) as SessionSchema
  const firmName = schema.business?.name ?? 'the firm'

  // This admin tool does NOT take the client `processing` lock (that belongs to
  // the onboarding chat); sharing it let a client conversation block admin
  // edits. useChat serializes per user.
  const system = `You are a website content editor for ${firmName}, a CPA firm. You edit a single markdown file on the site.

${buildBrandVoiceBlock(schema)}

${buildFirmContext(schema)}

THE FILE BEING EDITED (${path}):
"""
${currentContent}
"""

The admin will describe a change. Make ONLY what they ask for and return the COMPLETE updated file via the write_content_file tool.
- Preserve the YAML frontmatter block (between --- fences) and every \`<!-- block: ... -->\` annotation comment EXACTLY, unless the admin explicitly asks to change them.
- Keep markdown structure, headings, and image references intact.
- Write clean, on-brand copy grounded in the firm profile above. NEVER invent facts (credentials, numbers, named people, dates) not supported by the profile or the existing file.
After writing, briefly tell the admin what you changed.`

  const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system,
      messages: await convertToModelMessages(trimMessages(messages)),
      maxOutputTokens: 8000,
      tools: {
        write_content_file: {
          description: 'Write the complete updated markdown file. Pass the FULL file content, not a diff.',
          inputSchema: z.object({
            content: z.string().describe('The complete new file content (frontmatter + body), preserving annotations.'),
          }),
          execute: async ({ content }) => {
            await writeFile(
              ctx.githubRepo,
              path,
              content,
              DRAFT_BRANCH,
              `Edit ${path.split('/').pop()} via AI${ctx.adminEmail ? ` (${ctx.adminEmail})` : ''}`,
              { authorName: 'CountingFive Admin', authorEmail: ctx.adminEmail ?? 'admin@countingfive.com' }
            )
            reviewContentEdit(ctx.sessionId, path, content)
            return { success: true }
          },
        },
      },
      stopWhen: stepCountIs(5),
      onFinish: async ({ totalUsage }) => {
        await recordTokenUsage({
          task: 'content',
          sessionId: ctx.sessionId,
          stage: 'content_edit',
          pageUrl: path,
          model: 'claude-sonnet-4-6',
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
        })
        await supabase
          .from('sessions')
          .update({ last_activity_at: new Date().toISOString() })
          .eq('id', ctx.sessionId)
      },
    })

  return result.toUIMessageStreamResponse()
}
