import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { anthropic } from '@ai-sdk/anthropic'
import { NextResponse } from 'next/server'
import { toolError, ToolUserError } from '@/lib/api/tool-error'
import { z } from 'zod'
import { resolveEditContext } from '../_helpers'
import { safePath } from '../_path'
import { readJsonBody } from '@/app/api/_json'
import { isSiteOwner } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { trimMessages } from '@/lib/agent/trim-messages'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { CACHE_EPHEMERAL, extractCacheUsage } from '@/lib/content/cache-control'
import { INTERACTIVE_CHAT_MODEL, chatProviderOptions } from '@/lib/content/generation-tuning'
import { buildBrandVoiceBlock, buildFirmContext } from '@/lib/content/brand-voice'
import { loadNoGoPhrases, buildNoGoPromptBlock, findNoGoHits } from '@/lib/content/no-go-phrases'
import { insertMbpSuggestion } from '@/lib/mbp/create-suggestion'
import { applyFindReplace, applyBatchEdits, validatePageAnnotations } from '@/lib/editor/apply-edit'
import { blockCatalogHint } from '@/lib/content/block-annotation-validator'
import { sanitizeGeneratedText, humanizeDashes } from '@/lib/content/anti-slop-validator'
import { applyBulkRemovals, countPhrase } from '@/lib/editor/bulk-remove'
import { logAndFormatAiStreamError } from '@/lib/ai/ai-error'
import { checkChatSpendLimit } from '@/lib/ai/chat-spend-limit'
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
// Batched edits (apply_edits / remove_text) keep the tool-loop short, but a
// worst-case multi-part run still makes several sequential GitHub commits —
// 300s is the platform max and covers it.
export const maxDuration = 300

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
  const user = ctx.user
  if (!(user.isAdmin || isSiteOwner(user))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await readJsonBody<{ messages: UIMessage[]; path?: string }>(req)
  if (body instanceof NextResponse) return body
  const { messages, path: rawPath } = body
  const path = rawPath ? safePath(rawPath) : null
  if (!path || !EDITABLE.some(p => path.startsWith(p))) {
    return NextResponse.json({ error: 'Open a page or post to edit with AI' }, { status: 400 })
  }

  const supabase = createServerClient()

  // Per-user spend ceiling (lowest for Site Owners), checked before any model
  // call or GitHub read — see lib/ai/chat-spend-limit.ts.
  const overLimit = await checkChatSpendLimit(supabase, user)
  if (overLimit) return overLimit

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
    authorName: adminName ?? DEFAULT_COMMIT_AUTHOR.name,
    authorEmail: adminEmail ?? DEFAULT_COMMIT_AUTHOR.email,
  }

  // Write the new file to draft and advance the working copy + sha. Throws on a
  // GitHub failure or a stale sha; callers convert that into a tool error.
  async function commitWorking(next: string, message: string): Promise<void> {
    // Auto-scrub em/en dashes in the page BODY on every edit (code fences and
    // `<!-- block -->` annotations are protected; numeric ranges kept). Kept here
    // so apply_edit, set_faq, and remove_text all leave the prose dash-clean
    // without each tool remembering to do it. Idempotent. Frontmatter is left
    // byte-for-byte alone: it holds URLs, JSON blobs (faq_block, internal_links)
    // and quoted YAML that a blind text rewrite can corrupt — remove_text's
    // explicit stripDashes handles SEO fields when asked.
    const { body: nextBody } = splitFile(next)
    const head = next.slice(0, next.length - nextBody.length)
    const scrubbed = head + humanizeDashes(nextBody)
    // Reject any edit that would leave the file with invalid YAML frontmatter
    // before it lands in the draft — otherwise it surfaces as a broken `next
    // build` at deploy time. The tool executors catch this throw and return the
    // message to the model, which can retry with the value properly quoted.
    const yamlError = validateFrontmatterYaml(scrubbed)
    if (yamlError) throw new ToolUserError(yamlError)
    const res = await writeFile(githubRepo, path!, scrubbed, DRAFT_BRANCH, message, {
      expectedSha: workingSha,
      ...commitAuthor,
    })
    workingContent = scrubbed
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

  // Global admin-curated no-go phrases: injected into the prompt so the model
  // avoids them, and checked after each committed edit so we warn (never
  // silently delete) if one gets reintroduced.
  const noGoPhrases = (await loadNoGoPhrases()).map(p => p.phrase)
  const noGoBlock = buildNoGoPromptBlock(noGoPhrases)

  // This admin tool does NOT take the client `processing` lock (that belongs to
  // the onboarding chat); sharing it let a client conversation block admin
  // edits. useChat serializes per user.
  const systemStatic = `You are a website content editor for ${firmName}, a CPA firm. You edit a single markdown file on the site.

${buildBrandVoiceBlock(schema)}

${buildFirmContext(schema)}${noGoBlock ? `\n\n${noGoBlock}` : ''}

HOW YOU EDIT
Never introduce em-dashes or en-dashes (— –) in any copy you write; use commas, periods, or colons instead. They read as AI-written.
You do NOT rewrite the whole file. You make small, targeted changes with these tools.
BATCH your work: a request usually implies MANY edits (rewrite several sentences, reword every mention of X, fix each section). Group them — issue ONE apply_edits call for all rewrites and ONE remove_text call for all deletions — instead of many single apply_edit calls. Batching lands them in one commit and keeps the whole request in a single run; firing edits one at a time can hit the run's step cap and stop early.
- apply_edits({ edits: [{ find, replace, all? }] }) — apply MANY exact find/replace rewrites in ONE commit. This is the DEFAULT for any multi-part edit. Each \`find\` is an EXACT snippet copied verbatim from the file (matching whitespace, punctuation, casing); it must match exactly ONE place unless all=true. All finds are matched against the SAME current file, so don't target text that another edit in the same batch rewrites. The result lists which edits applied and which missed (re-copy an exact snippet for any miss).
- apply_edit({ find, replace, all? }) — same exact-snippet rewrite for a SINGLE one-off change. Use apply_edits when you have more than one. Use apply_edit for LAYOUT changes to a \`<!-- block: ... -->\` annotation. Keep every annotation and valid YAML frontmatter STRUCTURE intact — but the SEO frontmatter VALUES (meta_title, meta_description, secondary_keywords, answer_block, eeat_signals) ARE editable and count as the page's "SEO information"; edit them when the admin asks.
- remove_text({ removals: [{ find, replace? }], caseInsensitive?, stripDashes? }) — remove or replace EVERY occurrence of one or more phrases across the WHOLE page at once (body AND SEO/frontmatter fields). Use this whenever the admin says "remove all references to / delete every mention of / strip X" (list each phrase as one removal) or "remove all em-dashes" (set stripDashes: true). Prefer ONE remove_text call over many apply_edit calls. Set caseInsensitive when spelling/casing may vary.
- set_faq({ items }) — replace the page's ENTIRE FAQ list. Read the current FAQ from the file below, then pass the full desired list (add, edit, remove, or reorder items). This keeps the frontmatter and the on-page FAQ in sync — never hand-edit faq_block with apply_edit. (remove_text may clear a phrase from FAQ text; use set_faq to add/edit/reorder FAQ entries.)
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
- When remove_text returns, report its numbers honestly: state per-phrase how many you removed (\`applied\`), and note any phrase with removed 0 as "not found on this page". If \`residual\` is non-empty, that phrase is STILL on the page — say so and fix it, don't claim it's gone. If \`firmWide\` is non-empty, the phrase also lives in brand.json or the firm profile and will reappear on the next rebuild — tell the admin, and offer to flag the firm profile (MBP) so it's removed everywhere. Do NOT claim a phrase is fully removed when residual or firmWide say otherwise.
- NO-GO PHRASES: the firm keeps a hard-banned phrase list (shown above if any). Never write one into the page. If a tool result includes \`noGoWarning\`, your edit left a banned phrase on the page — tell the admin plainly which phrase and rewrite it out; do not claim the edit is clean while a no-go phrase remains.

IMPROVING THE MBP
Watch for anything durable the admin states that should apply to ALL of this firm's content going forward — not just this file. Two kinds count:
1. Facts about the firm or team not already in the profile: a new certification, a new service, a corrected title, a real client win, a shift in positioning.
2. Brand voice / writing rules and content constraints: a required or forbidden tone, words or formatting to avoid (e.g. "never use em-dashes or emojis"). Map avoid-rules to brand.toneToAvoid with op "append" (one concise entry per rule, e.g. "em-dashes", "emojis"); map tone shifts to the relevant brand.* field; map facts to their field.
When such a durable rule or fact surfaces (and isn't already in the profile), FIRST honor it in the file edit, then ASK the admin whether to add it to the firm's MBP so all future content follows it — e.g. "Want me to add 'no em-dashes, no emojis' to their MBP so every future piece avoids them?". Only after the admin confirms, call the suggest_mbp_update tool. Propose only what the admin stated or confirmed — never guesses. suggest_mbp_update files a PENDING suggestion for admin review; it does NOT change the profile, so never say the MBP was updated — say you've flagged it for review.`
  // The page is its own system block AFTER the cached one: it changes with every
  // edit, so keeping it out of the marked prefix lets follow-up turns re-read
  // tools + instructions + firm context from cache.
  const systemFile = `THE FILE BEING EDITED (${path}) — as it was at the START of this request. Every successful tool call in this run changes it; the tool results are authoritative for what changed since, so never rebuild content (e.g. a set_faq list) that re-adds text an earlier tool removed:
"""
${workingContent}
"""`

  // Phrases remove_text cleared earlier in this run. set_faq rebuilds the FAQ
  // from the model's view of the file (the start-of-run snapshot above), so it
  // can quietly write a removed phrase back — re-check these after it commits.
  const removedThisRun: { find: string; caseInsensitive: boolean }[] = []

  const result = streamText({
      model: anthropic(INTERACTIVE_CHAT_MODEL),
      providerOptions: chatProviderOptions('medium'),
      system: [
        { role: 'system', content: systemStatic, providerOptions: CACHE_EPHEMERAL },
        { role: 'system', content: systemFile },
      ],
      messages: await convertToModelMessages(trimMessages(messages)),
      // A heavy multi-part instruction (e.g. "remove every X and reword each
      // mention of Y" across body + SEO frontmatter) can exceed a small output
      // budget mid-run and truncate, prompting a re-run. Give the batched edits
      // room to land in one pass.
      maxOutputTokens: 32000,
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
            // Strip AI dash-tells from model-authored replacement text before it
            // lands in live content. humanizeDashes protects code fences and
            // block annotations, so layout edits stay intact.
            const res = applyFindReplace(workingContent, find, sanitizeGeneratedText(replace), all ?? false)
            // Already applied → nothing to commit; report it as a no-op, not a save.
            if (!res.ok && res.noop) return { success: true, noChange: true, message: res.reason }
            if (!res.ok) return { error: res.reason }
            const annotationErrors = validatePageAnnotations(res.next)
            if (annotationErrors.length > 0) {
              return { error: `That edit would break a block annotation: ${annotationErrors.join(' ')}` }
            }
            try {
              await commitWorking(res.next, `Edit ${path.split('/').pop()} via AI (${adminEmail ?? 'admin'})`)
            } catch (err) {
              return toolError('edit:chat', err, 'Failed to save the edit.')
            }
            const noGoWarning = findNoGoHits(workingContent, noGoPhrases)
            return { success: true, replacements: res.count, ...(noGoWarning.length ? { noGoWarning } : {}) }
          },
        },
        apply_edits: {
          description:
            'Apply MANY exact find/replace rewrites to this page in ONE commit. Use for any multi-part edit instead of many apply_edit calls. Reports which edits applied and which missed. Each find is matched against the same current file.',
          inputSchema: z.object({
            edits: z
              .array(
                z.object({
                  find: z.string().describe('Exact text to find, copied verbatim from the current file.'),
                  replace: z.string().describe('Replacement text (may be empty to delete the snippet).'),
                  all: z
                    .boolean()
                    .optional()
                    .describe('Replace every occurrence instead of requiring a single unique match.'),
                })
              )
              .min(1)
              .describe('The rewrites to apply together, in order, against the current file.'),
          }),
          execute: async ({ edits }) => {
            // Sanitize each replacement (strip AI dash-tells) at the call site,
            // mirroring apply_edit; the pure helper stays match-only.
            const sanitized = edits.map((e: { find: string; replace: string; all?: boolean }) => ({
              find: e.find,
              replace: sanitizeGeneratedText(e.replace),
              all: e.all,
            }))
            const res = applyBatchEdits(workingContent, sanitized)
            // Only commit when something actually landed; when every find missed
            // the page is unchanged — return the misses so the model re-copies.
            const changed = res.next !== workingContent
            if (changed) {
              const annotationErrors = validatePageAnnotations(res.next)
              if (annotationErrors.length > 0) {
                return { error: `That edit would break a block annotation: ${annotationErrors.join(' ')}` }
              }
              try {
                await commitWorking(res.next, `Edit ${path.split('/').pop()} via AI (${adminEmail ?? 'admin'})`)
              } catch (err) {
                return toolError('edit:chat', err, 'Failed to save the edits.')
              }
            }
            const noGoWarning = changed ? findNoGoHits(workingContent, noGoPhrases) : []
            return {
              success: true,
              applied: res.applied,
              failed: res.failed,
              ...(res.unchanged.length ? { unchanged: res.unchanged } : {}),
              ...(changed ? {} : { noChange: true }),
              ...(noGoWarning.length ? { noGoWarning } : {}),
            }
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
            const faqItems: FaqItem[] = items.map((i: FaqItem) => ({
              question: sanitizeGeneratedText(i.question),
              answer: sanitizeGeneratedText(i.answer),
            }))
            const nextFm = setFaqBlock(parsed.frontmatter, faqItems)
            const { content: bodyContent, trailer } = splitTrailers(parsed.body)
            const nextBody = setFaqAccordionBody(bodyContent, faqItems, 'Frequently Asked Questions')
            const next = serializeFile({ frontmatter: nextFm, body: nextBody + trailer })
            try {
              await commitWorking(next, `Edit FAQ on ${path.split('/').pop()} via AI (${adminEmail ?? 'admin'})`)
            } catch (err) {
              return toolError('edit:chat', err, 'Failed to save the FAQ.')
            }
            const noGoWarning = findNoGoHits(workingContent, noGoPhrases)
            const residual = removedThisRun
              .map(r => ({ find: r.find, remaining: countPhrase(workingContent, r.find, r.caseInsensitive) }))
              .filter(r => r.remaining > 0)
            return {
              success: true,
              count: faqItems.length,
              ...(noGoWarning.length ? { noGoWarning } : {}),
              ...(residual.length
                ? {
                    residual,
                    residualNote: 'This FAQ re-added text removed earlier in this run. Run remove_text again for these phrases.',
                  }
                : {}),
            }
          },
        },
        remove_text: {
          description:
            'Remove or replace EVERY occurrence of one or more phrases across the whole page, including SEO/frontmatter fields (meta_title, meta_description, keywords, FAQ). Use for "remove all references to X" or "strip em-dashes". Reports counts removed, any still remaining, and firm-wide hits.',
          inputSchema: z.object({
            removals: z
              .array(
                z.object({
                  find: z.string().describe('Exact phrase to remove, e.g. "Root Advisors".'),
                  replace: z.string().optional().describe('Replacement text (default: delete it).'),
                })
              )
              .default([])
              .describe('Phrases to remove/replace. May be empty when only stripDashes is set.'),
            caseInsensitive: z.boolean().optional().describe('Match regardless of letter case.'),
            stripDashes: z.boolean().optional().describe('Also normalize em/en dashes page-wide.'),
          }),
          execute: async ({ removals, caseInsensitive, stripDashes }) => {
            if (removals.length === 0 && !stripDashes) {
              return { error: 'Give at least one phrase to remove, or set stripDashes to clean em-dashes.' }
            }
            const ci = caseInsensitive ?? false
            const res = applyBulkRemovals(workingContent, removals, {
              caseInsensitive: ci,
              stripDashes: stripDashes ?? false,
            })
            const annotationErrors = validatePageAnnotations(res.next)
            if (annotationErrors.length > 0) {
              return { error: `That edit would break a block annotation: ${annotationErrors.join(' ')}` }
            }
            // Only commit when the file actually changed — a strip-dashes pass on
            // an already-clean page (or phrases not present) is a no-op, and an
            // identical write would be a pointless empty commit.
            const changed = res.next !== workingContent
            if (changed) {
              try {
                await commitWorking(res.next, `Remove text on ${path.split('/').pop()} via AI (${adminEmail ?? 'admin'})`)
              } catch (err) {
                return toolError('edit:chat', err, 'Failed to save the edit.')
              }
            }
            for (const r of removals as { find: string; replace?: string }[]) {
              if (r.find && r.find.trim() !== '' && !r.replace) removedThisRun.push({ find: r.find, caseInsensitive: ci })
            }
            // Page-scoped edit only, but a phrase living in a firm-wide source
            // (brand.json or the firm profile) reappears on the next rebuild —
            // surface that so the admin knows it isn't fully gone site-wide.
            const firmWide: { find: string; source: string; remaining: number }[] = []
            const targets = removals.filter((r: { find: string }) => r.find && r.find.trim() !== '')
            if (targets.length > 0) {
              let brandText = ''
              try {
                brandText = (await readFile(githubRepo, 'content/brand.json', DRAFT_BRANCH)).content
              } catch {
                brandText = ''
              }
              const schemaText = JSON.stringify(rawSchema)
              for (const { find } of targets) {
                const inBrand = countPhrase(brandText, find, ci)
                if (inBrand > 0) firmWide.push({ find, source: 'brand.json', remaining: inBrand })
                const inSchema = countPhrase(schemaText, find, ci)
                if (inSchema > 0) firmWide.push({ find, source: 'firm profile', remaining: inSchema })
              }
            }
            return {
              success: true,
              ...(changed ? {} : { noChange: true }),
              applied: res.applied,
              dashesStripped: res.dashesStripped,
              residual: res.residual,
              firmWide,
            }
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
              return toolError('edit:chat', err, 'Failed to update brand.json.')
            }
            let mbpFlagged = false
            try {
              mbpFlagged = (
                await insertMbpSuggestion(supabase, {
                  sessionId: sessionId,
                  origin: 'content_edit',
                  sourceRef: path,
                  summary: `Update firm ${field}`,
                  changes,
                  schema: rawSchema,
                })
              ).filed
            } catch (err) {
              console.error('[edit-chat] firm-contact MBP suggestion failed:', err)
            }
            const site = patched
              ? 'Updated site-wide (brand.json). Publish to push it live.'
              : 'brand.json was not changed (missing, unreadable, or already up to date); the site picks up the profile value at the next rebuild.'
            return {
              success: true,
              brandJsonUpdated: patched,
              mbpFlagged,
              note: mbpFlagged
                ? `${site} Flagged the firm profile (MBP) for review.`
                : `${site} Could NOT flag the firm profile (MBP) for review — tell the admin it needs a manual update.`,
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
          execute: async ({ summary, changes }) => {
            try {
              return await insertMbpSuggestion(supabase, {
                sessionId: sessionId,
                origin: 'content_edit',
                sourceRef: path,
                summary,
                changes,
                schema: rawSchema,
              })
            } catch (err) {
              // Return the failure to the model instead of throwing — an uncaught
              // throw here would surface to the client as the generic "hit an
              // error" banner even though the page edit itself may have succeeded.
              return toolError('edit:chat', err, 'Failed to file the MBP suggestion.')
            }
          },
        },
      },
      // A multi-part instruction ("remove every X, Y, Z") fans out into many
      // tool-loops; a low cap silently truncates the run mid-task. apply_edits /
      // remove_text batch most of that into single calls, so 40 is headroom the
      // model rarely reaches rather than the primary lever.
      stopWhen: stepCountIs(40),
      onFinish: async ({ totalUsage }) => {
        await recordTokenUsage({
          task: 'content',
          sessionId: sessionId,
          createdBy: user.id,
          stage: 'content_edit',
          pageUrl: path,
          model: INTERACTIVE_CHAT_MODEL,
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
          ...extractCacheUsage(totalUsage),
        })
        await supabase
          .from('sessions')
          .update({ last_activity_at: new Date().toISOString() })
          .eq('id', sessionId)
      },
    })

  return result.toUIMessageStreamResponse({
    // Relay the finish reason to the client so it can tell a truncated run
    // (`tool-calls` = the model was stopped while still wanting to edit) from a
    // clean stop, and report honest applied/incomplete status.
    messageMetadata: ({ part }) => (part.type === 'finish' ? { finishReason: part.finishReason } : undefined),
    onError: (error) => logAndFormatAiStreamError('edit-page', error),
  })
}
