import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveEditContext } from '../_helpers'
import { safePath } from '../_path'
import { getCurrentUser, isSiteOwner } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { trimMessages } from '@/lib/agent/trim-messages'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { buildBrandVoiceBlock, buildFirmContext } from '@/lib/content/brand-voice'
import { insertMbpSuggestion } from '@/lib/mbp/create-suggestion'
import { applyFindReplace, validatePageAnnotations } from '@/lib/editor/apply-edit'
import { blockCatalogHint } from '@/lib/content/block-annotation-validator'
import { splitFile, serializeFile } from '@/lib/editor/frontmatter'
import { validateFrontmatterYaml } from '@/lib/editor/frontmatter-yaml'
import { setFaqBlock, type FaqItem } from '@/lib/editor/structured-fields'
import { splitTrailers, setFaqAccordionBody } from '@/lib/editor/page-body'
import {
  DRAFT_BRANCH,
  ensureDraftBranch,
  readFile,
  writeFile,
  patchBrandJsonContact,
  FileNotFoundError,
} from '@/lib/github/repo-files'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
export const maxDuration = 120

// The agent only edits markdown content files (not nav.json/config/social).
const EDITABLE = ['content/pages/', 'content/posts/']

// The block catalog the layout tools may produce (id → variants), derived from
// BLOCK_CATALOG so it can't drift from the validator. The model picks valid
// ids/variants from this; validateAnnotationSyntax is the hard gate on write.
const BLOCK_CATALOG_HINT = blockCatalogHint()

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  const { githubRepo, sessionId, adminEmail, adminName } = ctx

  // resolveEditContext already enforced session access (incl. owners). The
  // per-page AI editor is limited to staff admins and Site Owners (who edit
  // their own site) — managers/editors don't get it.
  const user = await getCurrentUser()
  if (!user || !(user.isAdmin || isSiteOwner(user))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { messages, path: rawPath }: { messages: UIMessage[]; path?: string } = await req.json()
  const path = rawPath ? safePath(rawPath) : null
  if (!path || !EDITABLE.some(p => path.startsWith(p))) {
    return NextResponse.json({ error: 'Open a page or post to edit with AI' }, { status: 400 })
  }

  const supabase = createServerClient()

  // The live working copy of the file. Every tool edits this in memory, commits
  // to the draft branch, then advances the sha so the next tool builds on the
  // committed version (optimistic lock catches a concurrent save).
  let workingContent: string
  let workingSha: string
  try {
    await ensureDraftBranch(githubRepo)
    const initial = await readFile(githubRepo, path, DRAFT_BRANCH)
    workingContent = initial.content
    workingSha = initial.sha
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    throw err
  }

  const commitAuthor = {
    authorName: adminName ?? 'CountingFive Admin',
    authorEmail: adminEmail ?? 'admin@countingfive.com',
  }

  // Write the new file to draft and advance the working copy + sha. Throws on a
  // GitHub failure or a stale sha; callers convert that into a tool error.
  async function commitWorking(next: string, message: string): Promise<void> {
    // Reject any edit that would leave the file with invalid YAML frontmatter
    // before it lands in the draft — otherwise it surfaces as a broken `next
    // build` at deploy time. The tool executors catch this throw and return the
    // message to the model, which can retry with the value properly quoted.
    const yamlError = validateFrontmatterYaml(next)
    if (yamlError) throw new Error(yamlError)
    const res = await writeFile(githubRepo, path!, next, DRAFT_BRANCH, message, {
      expectedSha: workingSha,
      ...commitAuthor,
    })
    workingContent = next
    workingSha = res.blobSha
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', sessionId)
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
${workingContent}
"""

HOW YOU EDIT
You do NOT rewrite the whole file. You make small, targeted changes with these tools:
- apply_edit({ find, replace, all? }) — replace an EXACT snippet copied verbatim from the file above (matching whitespace, punctuation, and casing) with new text. Use this for copy edits, rewrites, and LAYOUT changes. \`find\` must be long enough to match exactly ONE place; if it could match several, include more surrounding text (or set all=true to replace every occurrence, e.g. a repeated phrase). Preserve the YAML frontmatter and every \`<!-- block: ... -->\` annotation unless the change is specifically about layout.
- set_faq({ items }) — replace the page's ENTIRE FAQ list. Read the current FAQ from the file above, then pass the full desired list (add, edit, remove, or reorder items). This keeps the frontmatter and the on-page FAQ in sync — never hand-edit faq_block with apply_edit.
- update_firm_contact({ ... }) — see FIRM-WIDE CONTACT below.

LAYOUT CHANGES (via apply_edit on the annotation comment)
Every section's layout is set by an HTML comment before its \`##\` heading, e.g.
\`<!-- block: content-split | variant: image-right | image: x.jpg | alt: "..." | query: "..." -->\`
Almost any layout request is just editing that comment's \`variant\` (or moving/adding/removing the whole block). Do it — don't tell the admin a layout isn't possible without first checking the variants below. What you can change:
- Image side (left/right) on \`content-split\` AND \`checklist-section\`: flip between \`image-right\`/\`image-left\` (content-split) or \`with-image-right\`/\`with-image-left\` (checklist-section). A legacy \`with-image\` checklist means image-on-right — rewrite it to \`with-image-left\` to move the photo left.
- Column count on card grids: \`feature-grid\`/\`industry-cards\` (3-col|4-col), \`service-cards\`/\`content-cards\` (2-col|3-col), \`team-grid\` (2-col|3-col|4-col), \`stats-bar\` (3-up|4-up).
- Text alignment: \`intro-text\` (centered|left-aligned). Steps orientation: \`process-steps\` (horizontal|vertical). Testimonials: \`testimonials\` (carousel|grid). CTA background: \`cta-banner\` (color-bg|image-bg). Pricing tiers / form type likewise via their variants.
- Add a section: insert a new \`<!-- block: ... -->\` comment + \`## Heading\` + body at a sensible anchor. Reorder/remove: move or delete a whole block (its comment + heading + body).
- Convert a block type (e.g. \`checklist-section\` → \`content-split\`) when the admin wants a layout the current block can't do: change the \`block:\` id to a valid one and adjust the body to fit (e.g. bullet list → prose). Confirm the intent first if it would drop content.
Only use these block ids and variants: ${BLOCK_CATALOG_HINT}. An edit that produces an unknown block id or an invalid variant is rejected — the tool tells you why, so fix it and retry.

FIRM-WIDE CONTACT (phone, fax, email, hours, address)
These are NOT page-specific — they render on every page (footer, contact page, on-page schema) from one shared source. When the admin asks to change any of them, FIRST ask whether to apply it firm-wide or only mention it on this page:
"Should I update the {phone/email/…} everywhere (footer, contact page, and every page's schema), or just here on this page?"
- Everywhere → call update_firm_contact. It updates the shared brand.json now (publish pushes it live everywhere) and flags the firm profile (MBP) for review. Say you've updated it site-wide and flagged the profile — never say the MBP itself was changed.
- Just this page → use apply_edit on this file only.

RULES
- Make ONLY what the admin asks for. Never invent facts (credentials, numbers, named people, dates) not supported by the firm profile above or the existing file.
- After a successful edit, briefly tell the admin what changed. If a tool returns an error, tell the admin plainly and try a corrected edit — do not claim success when a tool failed.

IMPROVING THE MBP
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
        apply_edit: {
          description:
            'Replace an exact snippet copied verbatim from the file with new text. Preserves the rest of the file. Use for copy edits and layout changes (e.g. flipping a content-split variant).',
          inputSchema: z.object({
            find: z.string().describe('Exact text to find, copied verbatim from the current file.'),
            replace: z.string().describe('Replacement text (may be empty to delete the snippet).'),
            all: z
              .boolean()
              .optional()
              .describe('Replace every occurrence instead of requiring a single unique match.'),
          }),
          execute: async ({ find, replace, all }) => {
            const res = applyFindReplace(workingContent, find, replace, all ?? false)
            if (!res.ok) return { error: res.reason }
            const annotationErrors = validatePageAnnotations(res.next)
            if (annotationErrors.length > 0) {
              return { error: `That edit would break a block annotation: ${annotationErrors.join(' ')}` }
            }
            try {
              await commitWorking(res.next, `Edit ${path.split('/').pop()} via AI (${adminEmail ?? 'admin'})`)
            } catch (err) {
              return { error: err instanceof Error ? err.message : 'Failed to save the edit.' }
            }
            return { success: true, replacements: res.count }
          },
        },
        set_faq: {
          description:
            'Replace the entire FAQ list for this page. Pass the full desired set of items; keeps frontmatter and the on-page FAQ block in sync.',
          inputSchema: z.object({
            items: z
              .array(z.object({ question: z.string(), answer: z.string() }))
              .describe('The complete FAQ list after your change (add/edit/remove/reorder).'),
          }),
          execute: async ({ items }) => {
            const parsed = splitFile(workingContent)
            if (!parsed.frontmatter) {
              return { error: 'This file has no frontmatter, so it cannot store an FAQ block.' }
            }
            const faqItems: FaqItem[] = items.map((i: FaqItem) => ({ question: i.question, answer: i.answer }))
            const nextFm = setFaqBlock(parsed.frontmatter, faqItems)
            const { content: bodyContent, trailer } = splitTrailers(parsed.body)
            const nextBody = setFaqAccordionBody(bodyContent, faqItems, 'Frequently Asked Questions')
            const next = serializeFile({ frontmatter: nextFm, body: nextBody + trailer })
            try {
              await commitWorking(next, `Edit FAQ on ${path.split('/').pop()} via AI (${adminEmail ?? 'admin'})`)
            } catch (err) {
              return { error: err instanceof Error ? err.message : 'Failed to save the FAQ.' }
            }
            return { success: true, count: faqItems.length }
          },
        },
        update_firm_contact: {
          description:
            'Apply a firm-wide contact change (phone, fax, email, hours, or address). Updates the shared brand.json (publishable now) AND files a pending MBP suggestion. Only call after the admin confirms "everywhere".',
          inputSchema: z.object({
            field: z.enum(['phone', 'fax', 'email', 'address', 'hours']),
            value: z.string().optional().describe('New value for phone, fax, or email.'),
            address: z
              .object({
                street: z.string(),
                line2: z.string().optional(),
                city: z.string(),
                state: z.string(),
                zip: z.string(),
              })
              .optional()
              .describe('New address (required when field is "address").'),
            hours: z
              .record(z.string(), z.string())
              .optional()
              .describe('Map of day → hours, e.g. {"Mon":"9–5"} (required when field is "hours").'),
          }),
          execute: async ({ field, value, address, hours }) => {
            let contactPatch: Record<string, unknown>
            let changes: { fieldPath: string; op: 'set'; proposedValue: unknown; rationale: string }[]
            const rationale = 'Operator updated firm-wide contact info via the content editor.'

            if (field === 'address') {
              if (!address) return { error: 'Provide the full address (street, city, state, zip).' }
              contactPatch = { address }
              changes = (
                [
                  ['street', address.street],
                  ['line2', address.line2 ?? ''],
                  ['city', address.city],
                  ['state', address.state],
                  ['zip', address.zip],
                ] as const
              ).map(([k, v]) => ({ fieldPath: `locations.0.${k}`, op: 'set', proposedValue: v, rationale }))
            } else if (field === 'hours') {
              if (!hours) return { error: 'Provide the hours as a map of day → hours.' }
              contactPatch = { hours }
              changes = [{ fieldPath: 'locations.0.hours', op: 'set', proposedValue: hours, rationale }]
            } else {
              if (!value) return { error: `Provide the new ${field}.` }
              contactPatch = { [field]: value }
              changes = [{ fieldPath: `locations.0.${field}`, op: 'set', proposedValue: value, rationale }]
            }

            let patched = false
            try {
              const r = await patchBrandJsonContact(githubRepo, DRAFT_BRANCH, contactPatch, commitAuthor)
              patched = r.patched
            } catch (err) {
              return { error: err instanceof Error ? err.message : 'Failed to update brand.json.' }
            }
            await insertMbpSuggestion(supabase, {
              sessionId: sessionId,
              origin: 'content_edit',
              sourceRef: path,
              summary: `Update firm ${field}`,
              changes,
              schema: rawSchema,
            })
            return {
              success: true,
              brandJsonUpdated: patched,
              mbpFlagged: true,
              note: patched
                ? 'Updated site-wide (brand.json) and flagged the firm profile for review. Publish to push it live.'
                : 'Flagged the firm profile for review; it will apply the next time the site is rebuilt.',
            }
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
              sessionId: sessionId,
              origin: 'content_edit',
              sourceRef: path,
              summary,
              changes,
              schema: rawSchema,
            }),
        },
      },
      stopWhen: stepCountIs(6),
      onFinish: async ({ totalUsage }) => {
        await recordTokenUsage({
          task: 'content',
          sessionId: sessionId,
          stage: 'content_edit',
          pageUrl: path,
          model: 'claude-sonnet-4-6',
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
        })
        await supabase
          .from('sessions')
          .update({ last_activity_at: new Date().toISOString() })
          .eq('id', sessionId)
      },
    })

  return result.toUIMessageStreamResponse()
}
