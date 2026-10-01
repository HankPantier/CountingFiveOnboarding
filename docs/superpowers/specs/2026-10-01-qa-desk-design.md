# QA Desk — agents between content generation and human review

## Context
Humans spend too long editing generated pages before approval. They fix four things: voice/copy quality, layout/UX, SEO/GEO, and factual accuracy. Today the only gate is the Opus draft critic (`lib/content/critic-review.ts`, run from `reviewAndMaybeRegen` in `content-generator.ts:958`). It scores 7 dimensions, rewrites the whole page once on a fail, and is advisory only. Nothing fixes voice, SEO or layout directly, and nothing looks at the rendered page.

Goal: a **QA Desk** stage that auto-fixes safe issues and flags risky ones before a human sees the page, so humans review instead of edit. Success metric: manual edits per page in Edit Activity (`lib/content/edit-stats.ts`) drop by 50%.

Decisions made in brainstorming:
- **Autonomy:** fix, then report. Agents auto-fix safe issues and only flag risky ones (facts, section removal).
- **UI checks:** both structural and rendered.
- **Budget:** about $0.50 per page.
- **Architecture:** a separate pipeline stage (QA Desk), not an extension of the critic and not a single agentic editor.

## Program: 4 sub-projects, each with its own spec, plan and build
1. **QA Desk core.** Stage plumbing, deterministic rules, the four specialists (Accuracy, Copy Editor, SEO/GEO, Structure), patch merger, Opus judge (replaces today's critic step), report UI, shadow mode. **This spec.**
2. **Site-level SEO/GEO.** Cross-page title/meta uniqueness, internal-link graph balance, cannibalization, llms.txt/schema consistency. Runs once per job after every page is QA'd.
3. **Rendered UI/UX pass.** Playwright in Vercel Sandbox against the draft-branch preview (URL from `lookupVercelPreviewUrl`, protection-bypass token from a server env var). Pages at 1440px and 390px. Deterministic checks: broken images, overflow, console errors, axe, CTA above the fold, contrast, side alternation in the DOM. Opus vision critique on one sample page per page type plus any page that fails a check. Results go in `qa_review.rendered`; fixes are flagged with a one-click commit to the draft branch. Only broken images block publish.
4. **Learning loop.** A weekly job compares human edits after QA with the QA'd version, clusters recurring fixes, and proposes new rules, no-go phrases or voice rules. Every proposal follows the ask-then-file rule (operator confirms).

## Sub-project 1 design: QA Desk core

### Flow (per page)
1. **Queue.** When `generateSinglePage` writes `complete`, it sets `qa_status='queued'`. QA failure never blocks the page.
2. **Claim.** The QA worker claims a row atomically: `.update({qa_status:'running', qa_started_at}).neq('qa_status','running')`, mirroring `generateSinglePage`. It runs with its own budget, in `after()` with self-chaining like `runContentGeneration` (`content-generator.ts:1585-1695`, `Bearer CRON_SECRET` continuation).
3. **Rules (deterministic, free)** in `lib/content/qa/rules/`:
   - **Media-side alternation** across the whole page: start from the frontmatter `hero_variant` side, cover `content-split` (`image-left|image-right`) and `checklist-section` (`with-image`/`with-image-right` = right, `with-image-left` = left), and skip blocks without an image (the side sequence carries across them). Auto-fix with `setSectionVariant` (`lib/editor/section-layout.ts`). Parse with `parseBlockAnnotations` (`block-annotation-validator.ts:452`).
   - **Copy checks:** no-go phrases (`findNoGoHits`), anti-slop (`validateContent`), `validateHeroSubhead`, `validateFaqAnswers`.
   - **SEO field checks:** meta title 50–60 chars and description 150–160; exactly one H1; no skipped heading levels.
   - Extend the existing consecutive-split rule (`block-annotation-validator.ts:289-299`) rather than duplicating it.
4. **Specialists**, in parallel on Sonnet 5.5 via a new constant `QA_SPECIALIST_MODEL = PUBLISHED_CONTENT_MODEL` in `generation-tuning.ts` (same id, so it is already in `PRICING`), using `GENERATION_PROVIDER_OPTIONS`; add the constant to the CLAUDE.md tier map:
   - **Accuracy:** checks every concrete claim (services, credentials, titles, numbers, years, locations, guarantees) against `schema_data` (with `_meta` stripped), firm context, verbatim sources and directives. Claims are always `flag`, with a grounded rewrite or a remove suggestion. Exact contact-detail mismatches (phone, address, email) are `auto`.
   - **Copy Editor:** voice (`brand.tone`, `toneToAvoid`), grammar, typos, repetition across sections, generic AI phrasing, weak openers, overlong paragraphs. `auto`, scoped to a sentence or paragraph.
   - **SEO/GEO:** meta fields (keyword, length), H1/H2 keyword placement, the first 100 words, alt text, internal links (valid sitemap slugs, 2–4 per page, descriptive anchors). GEO: a 40–60 word direct answer up front on service/topic pages, question-style H2s, self-contained FAQ answers, consistent entity naming, attributed statistics, the right schema type. Mostly `auto`; adding a section is `flag`.
   - **Structure (markdown level):** block choice vs content (6+ items should be cards), rhythm (no 3 text-only sections in a row), CTA presence and position, image presence, sensible image queries. Variant swaps are `auto`; adding, removing or reordering sections is `flag`.
   - **Output:** each specialist returns at most 15 `Finding`s through structured output (no forced `toolChoice`, no temperature).
   - **Caching:** a stable instruction prefix via `buildCachedMessages` (`lib/content/cache-control.ts`); page, MBP extract and outline go in the suffix.
   - **Verbatim pages** (`generation_mode='verbatim'`): rules plus SEO fields only. Patches never touch verbatim bios or directive-locked text.
5. **Merge** (`lib/content/qa/merge.ts`):
   - `auto` patches go to `applyBatchEdits` (`lib/editor/apply-edit.ts:78`, compound-safe), then `checkEditAnnotations` (`:112`).
   - A failed, ambiguous or annotation-breaking patch becomes a `flag`.
   - Meta-field patches write the `meta_title`/`meta_description` columns.
6. **Opus judge** (`CRITIC_MODEL`): reuses `scoreDraft` with added `voice`, `seo_geo` and `structure` dimensions on `CriticReview`.
   - **Pass rule:** today's `decideCriticAction` plus no open high-severity Copy or SEO findings.
   - **On fail:** one targeted fix pass that sends only the failing findings back to the relevant specialist as patches. This replaces `rewritePageForCritic`'s whole-page regeneration in the QA path.
7. **Persist.** Content and `qa_review` are written under the existing write guard: still `complete`, still unapproved, same `generation_started_at`. If a human edited the page meanwhile, QA discards its patches and keeps the flags. Then `qa_status='done'`.
8. **Phase advance.** Moving from phase 5 to 6 and sending the "content ready" email (`content-generator.ts:1698-1755`) wait until every page has `qa_status` in (`done`, `error`, `skipped`).

### Data (migration 083 + regen `types/database.ts`)
- `generated_pages`: add
  - `qa_status text` (`queued|running|done|error|skipped`, nullable)
  - `qa_started_at timestamptz`
  - `qa_review jsonb`
  - `qa_attempts int default 0`
- **Types**, in `types/qa-review.ts`:
  - `Finding {id, agent, severity: 'high'|'med'|'low', kind, quote, message, patch?: {find, replace}, safety: 'auto'|'flag', status: 'applied'|'open'|'dismissed'|'accepted'}`
  - `QaReview {mode, findings[], scores, judge: CriticReview, fixedCount, openCount, cost, ran_at}`
- **Mode:** env var `CONTENT_QA_MODE=off|shadow|on`, default `shadow` at launch. In shadow mode, QA stores findings with `status:'open'` and applies nothing.
- Token stages `qa_rules|qa_accuracy|qa_copy|qa_seo|qa_structure|qa_judge` added to `TokenStage` (`token-pricing.ts:9`). Every call passes `...extractCacheUsage(usage)`.

### Ops
- `sweep-stuck-jobs`: QA rows `running` for more than 15 min → `error`. Resume `queued` rows for stalled jobs, extending the existing cron (no manual scripts).
- `qa_attempts` capped at 2.
- 5xx responses go through `internalError`.

### UI
- `GenerationPhase.tsx` chip: "QA: fixed N · needs you M" plus the judge score. It replaces the critic chip (critic data still shows for old pages).
- `MarkdownPreviewModal` QA panel: open flags shown inline next to the quoted text, with **Apply** (runs the patch through the same merge path) and **Dismiss**, plus a collapsible "What QA changed" diff list.
- New route `PATCH /api/content/[jobId]/pages/[pageId]/qa-findings` gated with `requireContentJobAccess`. It applies or dismisses one finding through `applyBatchEdits` + `checkEditAnnotations`, with a CAS on the row.
- Content Quality dashboard (`app/admin/content-quality/`): QA scores, plus fixed/flagged/dismissed rates per agent and kind (dismiss rate drives tuning).
- Follow `raw-docs/design.md` tokens.

### New files (representative)
- `lib/content/qa/`:
  - `run-qa.ts` (orchestrator)
  - `rules/media-alternation.ts`, `rules/seo-fields.ts`, `rules/index.ts`
  - `specialists/{accuracy,copy-editor,seo-geo,structure}.ts` + `prompts/`
  - `merge.ts`, `judge.ts`
- `app/api/content/[jobId]/qa/run/route.ts`: worker + self-chain; CRON_SECRET bearer (fail closed) or `requireContentJobAccess` for manual re-run.
- `scripts/compare-qa.ts`: A/B specialist prompts and models; Opus judge.

## Verification
- Unit tests:
  - alternation rule (mixed content-split/checklist/hero, blocks without images in between, auto-fix output)
  - merge (overlapping patches, annotation-breaking patch → flag, verbatim-protected text)
  - finding parsing
  - write-guard race (human edit wins)
  - `token-pricing.test.ts` still green
- Seeded-defect fixture pages, including Korbey Lague content: assert each specialist catches its planted defect.
- `npx tsc --noEmit`, lint, full vitest, `next build`, plus the CLAUDE.md pre-commit greps.
- Live, in shadow mode on 2–3 clients: generate content, then confirm `qa_review` fills, the phase-6 email waits for QA, cost per page is ≤ $0.50 on the Token Usage dashboard, and the flags make sense in the preview modal.
- Then switch to `on` for one client and compare Edit Activity manual edits per page against that client's previous batches.

## Next step after approval
Save this spec to `docs/superpowers/specs/2026-10-01-qa-desk-design.md`, commit it, then run superpowers:writing-plans for sub-project 1.
