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
import { insertMbpSuggestion } from '@/lib/mbp/create-suggestion'
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
  if (!user || !user.isAdmin) {
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
  const rawSchema = (session?.schema_data ?? {}) as Record<string, unknown>
  const schema = rawSchema as SessionSchema
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
After writing, briefly tell the admin what you changed.

IMPROVING THE MBP:
Watch for anything durable the admin states that should apply to ALL of this firm's content going forward — not just this file. Two kinds count:
1. Facts about the firm or team not already in the profile: a new certification, a new service, a corrected title, a real client win, a shift in positioning.
2. Brand voice / writing rules and content constraints: a required or forbidden tone, words or formatting to avoid (e.g. "never use em-dashes or emojis"). Map avoid-rules to brand.toneToAvoid with op "append" (one concise entry per rule, e.g. "em-dashes", "emojis"); map tone shifts to the relevant brand.* field; map facts to their field.
When such a durable rule or fact surfaces (and isn't already in the profile), FIRST honor it in the file edit, then ASK the admin whether to add it to the firm's MBP so all future content follows it — e.g. "Want me to add 'no em-dashes, no emojis' to their MBP so every future piece avoids them?". Only after the admin confirms, call the suggest_mbp_update tool. Propose only what the admin stated or confirmed — never guesses. suggest_mbp_update files a PENDING suggestion for admin review; it does NOT change the profile, so never say the MBP was updated — say you've flagged it for review.`

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
              { authorName: ctx.adminName ?? 'CountingFive Admin', authorEmail: ctx.adminEmail ?? 'admin@countingfive.com' }
            )
            // No background MBP auto-file here: the agent surfaces durable MBP
            // improvements interactively (ask-then-file via suggest_mbp_update)
            // per the interactive-agent rule in CLAUDE.md. Manual saves
            // (files/route.ts) still run the background review.
            return { success: true }
          },
        },
        suggest_mbp_update: {
          description:
            'Queue a pending MBP suggestion (for admin review) when the conversation surfaces a durable, verifiable fact or brand-voice/writing rule not already in the profile. Only call after the admin confirms. Does NOT change the profile.',
          inputSchema: z.object({
            summary: z.string().describe('One-line summary of what should change'),
            changes: z
              .array(
                z.object({
                  fieldPath: z
                    .string()
                    .describe('Dotted MBP field path, e.g. brand.toneToAvoid or business.tagline'),
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
              sessionId: ctx.sessionId,
              origin: 'content_edit',
              sourceRef: path,
              summary,
              changes,
              schema: rawSchema,
            }),
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
