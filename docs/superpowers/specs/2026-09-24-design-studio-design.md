# Design Studio — in-platform AI theme design (admin-only)

## Context

Today a client's visual design comes from a manual detour:
1. Run `npm run export-brief` in a client checkout (template `scripts/export-design-brief.ts`, which produces a `design-kit/` folder).
2. Paste it into Claude.ai Design.
3. Hand-save the CSS that comes back into `content/design-overrides.css`.

It's cumbersome and the results have been weak. Exploration found these root causes:

- **Claude Design can only add CSS on top.** It can't change tokens, treatments or type in a way the site honours.
- **Fonts never reach the live site.** Template `src/app/layout.tsx` hardcodes `Public_Sans`, `Fraunces` and `Geist_Mono` via next/font. Every font choice is preview-only.
- **No feedback loop.** Claude Design never sees its CSS rendered on the client's real pages. The screenshots it gets are of the unstyled template.
- **The Theme Studio preview can't show treatments.** `compose-srcdoc.ts` never sets `data-headline` / `data-eyebrow`, and it only previews the homepage.
- **Existing gap:** `pushAssembledDeliverable` never writes `src/styles/theme.css`, so platform-seeded sites may ship the template's default theme until someone edits it in Theme Studio.

**Goal:** a Design Studio inside the editor, for **admins only**. It will:
- generate **2–3 distinct named concepts** from the MBP, the logo, the block catalog, the real rendered pages, and inputs you add (inspiration, the client's current site, competitors);
- have the AI **see and critique its own renders** before you do;
- let you pick one concept, then **revise it in a vision-capable chat**, with versions you can revert to;
- use publishing unchanged.

### Decisions you made

| Topic | Decision |
|---|---|
| Design freedom | **CSS + template levers**: palette, tokens, fonts that actually load live, treatments, style-axis presets, scoped CSS. The component tree stays shared. |
| Vision | **Full loop**: server renders, AI self-critique, and your annotated screenshots in chat. |
| Inputs | MBP + logo, inspiration URLs/images, the client's current site, and competitor sites. |
| Concept model | **Opus 5.5**, plus an A/B script against Fable 5.1. |
| Revision chat model | Sonnet 5 |
| Timing | In the editor, after deploy. It evolves Theme Studio. The pipeline's palette step stays as the seed. |
| Palette freedom | Chosen per run: keep / **evolve (default)** / free. |
| Legacy override CSS | **Removed by default on apply**, with a checkbox to keep it. |
| `/design-specimen` | Public, but noindex and unlinked. |
| Old ThemeChat | **Replaced** when the revision chat ships. The manual Controls tab stays. |
| export-brief | **Retired** once proven on about 5 clients. |
| Template rollout | New sites, plus opt-in per client. I'll show the roster before any rollout. The Studio falls back to CSS-only levers on older sites. |

**First step after approval:** commit this as a spec at `docs/superpowers/specs/2026-09-24-design-studio-design.md`, then use writing-plans for per-phase task plans.

---

## Architecture

### New module `lib/design/`, one purpose per unit

| Unit | File | Purpose |
|---|---|---|
| Bundle | `bundle.ts`, `bundle-files.ts` | Zod `DesignBundle` (see below). Pure bundle ⇄ repo-files conversion. `theme.css`, the overrides region and the fonts module are always *derived*. |
| Capabilities | `capabilities.ts` | Template level L0–L4, from `c5-template.json` on draft ∩ `<meta name="c5-capabilities">` on the deployed shell. See "Capability levels" below. |
| CSS sanitizer | `css-sanitizer.ts` | postcss + selector-parser + **LightningCSS** transform. The same engine compiles `design-overrides.css` in the client build, so bad CSS can't break a deploy. |
| Brief | `brief/*` | Ports the best of `export-design-brief.ts`. That means the Ink & Clay art direction, "a timid recolor is a failure", WCAG AA, navy-tinted shadows and one action CTA per screen. It also builds the capability-filtered token and selector contract, the block vocabulary (`BLOCK_CATALOG` / `blockCatalogHint()`), trimmed per-block HTML samples, and the brand brief (`buildBrandVoiceBlock`, `buildFirmContext`, `buildDesignMd`). |
| Concept generator | `concept-generator.ts` | One Opus 5.5 call makes N bundles. It then validates them, makes one repair retry, and runs a distinctness check. |
| Renderer | `render/{browser,render-composed,crops,metrics}.ts` | Headless Chromium `setContent` on the composed srcdoc. It captures viewport shots and `[data-block]` crops, plus metrics: axe contrast, mobile overflow, hidden blocks. |
| External capture | `capture/external.ts` | Screenshots inspiration, competitor and current-site URLs through the **ScrapingBee screenshot API**. The key already exists, and it keeps arbitrary third-party JS away from our secrets. |
| Critic loop | `critic.ts`, `run-orchestrator.ts`, `distinctness.ts` | Render, then deterministic gates, then Opus critique + revise, then render again. At most 2 revisions, within a per-run cost cap. |
| Apply / MBP sync | `apply-bundle.ts`, `sync-mbp-theme.ts` | `sync-mbp-theme.ts` is extracted from `app/api/edit/[id]/theme/route.ts`. Apply is one atomic `writeFiles` to draft with expected shas, plus the MBP sync via `updateSessionWithCas`, plus a version row. |
| Store | `store.ts`, `storage.ts` | Tables and private-bucket screenshots with signed URLs. |

**Capability levels:**
- **L0:** palette, tokens, CSS.
- **L1:** + treatments.
- **L2:** + fonts.
- **L3:** + style axes.
- **L4:** + specimen page.

**Renderer choice:** `@sparticuz/chromium` + `playwright-core` in a Node function, behind a `ScreenshotProvider` interface.
- Hardening:
  - scripts are stripped;
  - a CSP meta blocks script, connect and frame loads;
  - a request allowlist admits only the client's own origin, `fonts.googleapis/gstatic` and `data:`.
- Browserless or Vercel Sandbox is the fallback if the P1 go/no-go gate fails.

### Execution model

- A run moves through chained step invocations: capture → generate → refine per concept (the refines run in parallel).
- The step route `design/runs/[runId]/step` is admin **or** `Bearer CRON_SECRET` (fail-closed). This reuses the self-chaining pattern in `content-generator.ts`.
- `after()` kickoff; the client polls.

### Data model — migration `078_design_studio.sql`

Five tables. RLS on all five is admin-tier only (`admins.role='admin'`); the real gate is in the app.

| Table | What it holds |
|---|---|
| `design_inputs` | Kind (inspiration_url, inspiration_image, competitor_url, current_site), url, label, notes, storage_path, capture_status. **Kept separate from `assets`** so it never leaks into deliverables. |
| `design_runs` | Status, stage, admin_brief, palette_freedom, concept_count, capabilities snapshot, base_snapshot, cost_usd / cost_cap_usd (default $4), max_revisions (2). Partial unique index: **one active run per session**. |
| `design_concepts` | Bundle, initial_bundle, critique JSON, iterations, screenshots, cost. Atomic claim via `.neq('status','refining')`. |
| `design_versions` | Version_no (unique per session), source (baseline, concept, chat, revert, import), bundle, applied_commit_sha, applied_blobs. |
| `design_chat_messages` | Persisted chat. localStorage is banned, and attachments are stored by id only. |

**Versioning semantics:**
- **v0 = baseline import** of the current draft. It flags a stale `theme.css`.
- **Apply** = one draft commit.
- **Revert** = re-apply bundle k as a *new forward* version, never a `git revert`.
- **Drift banner** when the draft theme blobs differ from the latest version (for example after manual edits), with a "Capture as version" action.
- **"Live"** = the blobs on `main` match.
- **Publish** is the existing route, gated by `canPublish`. It publishes all of draft, and the UI says so.

**Storage:** `session-assets` under `design/{sessionId}/{inputs|runs|versions|attachments}/…webp`.
- Re-encoded with sharp to WebP, long edge ≤1568 px.
- Signed URLs only (3600 s); `getPublicUrl` is never used.
- Add the `design/` prefix to CLAUDE.md.

### `DesignBundle` shape

- **Identity:** `name`, `tagline`, `rationale`, `moves[]`.
- **Palette:** 6 hex roles.
- **Typography:** heading / body / accent, all from `CURATED_FONTS`. `gfUrl` is always built server-side.
- **Tokens:** roundness, density, visualFeel, radius, spacing.
- **Treatments.**
- **`style?: StyleAxes`**, only at L3 and above.
- **CSS:** `css: { global?, blocks: Record<blockId, css> }`.
- **Meta.**

---

## Template changes (`counting-five-client-template`)

1. **Capability marker.**
   - Root `c5-template.json`: `{templateVersion, capabilities[]}`.
   - `layout.tsx` emits the `c5-capabilities` meta.
2. **Live fonts via a generated next/font module.**
   - `src/lib/theme/font-manifest.ts` (⊇ `CURATED_FONTS` + Geist Mono).
   - `scripts/generate-fonts.ts` writes `src/app/fonts.generated.ts`, which `layout.tsx` imports. The default file reproduces today's fonts exactly.
   - A CI job builds every manifest font once.
   - Add `accentFont` to `src/lib/theme/types.ts`.
   - Why a generated module rather than a runtime `<link>`: it keeps the CSP `font-src 'self'`, self-hosting and no-CLS behaviour.
   - Platform side: a byte-parity port `lib/content/font-module-generator.ts` with a golden fixture, the same drift guard as `theme.css.golden`.
3. **Style axes.**
   - `design.json.style` maps to `<html data-*>` attributes.
   - A new `src/styles/style-axes.css` is imported after `theme.css` and before `design-overrides.css`.
   - v1 axes: `sectionRhythm`, `cards`, `buttons`, `heroScale`, `imageTreatment`, `nav`, `footer`, `accentUsage`. Each has 3–4 values; the default emits no attribute, so there is no visual change.
   - Small shared hooks where none exist: `data-c5="button"` and the hero accent span.
   - `docs/design/style-axes.json` gets a platform mirror and a parity test.
   - `theme.css` byte parity is untouched.
4. **`/design-specimen` page.** Production, noindex, excluded from the sitemap, unlinked. It shows the first real instance of each block from the client's own pages, falling back to the showcase `SAMPLE_CONTENT` (extracted to `src/lib/showcase/samples.ts`).
5. **Rollout.**
   - Rebase and merge the unmerged `feat/fleet-rollout` branch (stage → verify → promote), or fall back to the 09-08 fail-closed scripts.
   - `fonts.generated.ts` is excluded from overwrite but seeded if absent.
   - **Show the reconciled roster before rolling to any client.** `clients.json` is stale compared with the 10 treatment-synced repos.

---

## Safety and validation

- **Gates.** Every `app/api/edit/[id]/design/**` route starts with `requireDesignAdmin(id)`: `resolveEditContext` then `isAdmin`, otherwise 403.
  - The step route alternative is `CRON_SECRET`, fail-closed.
  - The FileTree entry stays `showTheme={isAdmin}`.
- **CSS sanitizer rules.** It also replaces the regex in `upsertBlockOverride`.
  - **Size caps:** 16 KB / 400 lines total, 60 lines per block.
  - **At-rules:** ban `@import`, `@apply`, `@theme` and the rest of Tailwind's directives, plus `@font-face` and `@layer`. Allow `@media`, `@supports`, `@container`, and `@keyframes c5-*` (reduced-motion gated).
  - **`url()`:** only `data:image/svg+xml` ≤2 KB, scrubbed.
  - **Selectors must be scoped** to `[data-block=…]`, `[data-component=…]`, known `html[data-axis]`, or `:root` custom properties (not `--color-*` or `--font-*-loaded`).
  - **Anti-hiding blocklist:** `display:none`, transparent text, tiny fonts, and similar.
  - **Output:** re-serialized into a managed region (`/* design-studio:begin */ … end`; the version lives in `design_versions`, not the file).
- **Hard gates before apply:**
  - `checkThemeContrast` passes;
  - axe AA on body text;
  - no mobile overflow;
  - no hidden blocks;
  - fonts and levers within capability.
- **Inputs.**
  - URLs: http(s) only, `isUrlPubliclyFetchable` before calling ScrapingBee.
  - Uploads: ≤8 MB, magic bytes via `file-type`, sharp re-encode, deleted on failure.
  - The shell `?path=` param is decoded and normalized, then checked same-origin (rule 8).
- **Prompt hygiene.**
  - Strip `_meta`, run `serializeSchema()`, and never send `mbp_content`.
  - Competitor, inspiration and admin notes are fenced as data.
  - Opus: no `toolChoice`, no temperature. Use `generateText` → `extractJson` → zod, like `draft-critic.ts`.
- **Errors and concurrency.**
  - 5xx responses go through `internalError`; `StaleShaError` → 409.
  - One active run per session (partial unique index).
  - **Sweep cron** extended to runs, concepts and inputs that are stale for more than 15 or 10 minutes.
  - Retry resumes from the first stage that isn't ready.
- **Cost.**
  - A typical run (3 concepts, ≤2 revisions) costs about $1.3–2.0, with a hard cap of $4 per run.
  - A chat turn costs about $0.04–0.08. Images are kept only in the last 2 user turns.
  - Every call is recorded with `recordTokenUsage` + `extractCacheUsage`, using new stages `design_concept`, `design_critique` and `design_chat` (app-validated union, no migration).

---

## Phased delivery

Each phase ships on its own. Track T (template) runs in parallel after P0.

### P0 — Foundations (no new UI)
- `DESIGN_MODEL = 'claude-opus-5-5'` in `lib/content/generation-tuning.ts`.
- Fable entry in `PRICING` (confirm the id and price), plus the new `TokenStage`s in `lib/content/token-pricing.ts`.
- Build the bundle, bundle-files, sanitizer, apply-bundle and sync-mbp-theme units.
- Refactor the theme route and chat onto them, with no behaviour change.
- **Fix the treatment preview now:** `setHtmlAttributes` in `compose-srcdoc.ts`, passed from `ThemePreview.tsx`.
- Add `postcss`, `postcss-selector-parser` and `lightningcss` as direct dependencies.

### P1 — Renderer spike, then service
- `lib/design/render/*`, `capture/external.ts`, and the `design/render` and `design/pages` routes.
- Shell `?path=` support.
- `next.config.ts` `serverExternalPackages` + file tracing; `vercel.json` memory 3009 and maxDuration.
- **Go/no-go gate** on a Vercel preview deploy: warm p95 under 5 s per render and no out-of-memory. If it fails, swap the provider.

### P2 — Data model, inputs, baseline versions
- Migration 078. You apply it; `types/database.ts` is stubbed, then regenerated.
- `store.ts`, the inputs CRUD, capture and upload routes, `design/route.ts` (state + drift), and baseline v0.
- `ThemeStudio.tsx` gets "Studio | Controls" tabs, plus `InputsPanel` and `VersionsPanel`.
- Competitors are pre-filled from `business.competitors[].name`; you type the URL. The MBP is not written.

### P3 — Brief + concept generation (useful without critique)
- `brief/*`, `concept-generator.ts` and the orchestrator.
- `runs` / `step` / `cancel` / `concepts/[cid]/apply` routes.
- `generateJson` accepts `messages` (images).
- A cached multi-part message helper in `cache-control.ts`.
- UI: RunLauncher (palette freedom, admin brief, inputs), ConceptCards, CompareGrid (synced screenshots), PagePicker, ViewportToggle (1440 / 768 / 390, scaled iframe).
- Apply dialog with "Remove legacy overrides" (default on).

### P4 — Vision critique loop
- `critic.ts`, `metrics.ts` (axe, overflow, hidden) and `distinctness.ts` (ΔE via chroma-js).
- Rubric scored 1–5: brandFit, distinctiveness, hierarchy, legibility, consistency, craft.
- Pass rule: all ≥3, mean ≥3.8, distinctiveness ≥4.
- UI: CritiqueView and BeforeAfter.

### P5 — Revision chat with vision
- `design/chat` route on Sonnet 5, `chatProviderOptions('medium')`, cached stable system block plus a dynamic bundle block.
- Tools: set_palette / fonts / tokens / treatments / style_axes / block_css, remove_block_css, `render_preview` (returns an image via `toModelOutput`, at most 2 per turn) and `commit_version`.
- `onFinish` auto-commits anything staged.
- Attachments route, AnnotateCanvas (boxes, arrows, pins), and version restore/import routes.
- **Replaces the old ThemeChat.**

### T1 — Template: marker + fonts module + accentFont
Platform follow-up **P6a**: font generator golden, manifest parity test, fonts unlocked at L2.

### T2 — Template: style axes + specimen
Platform follow-up **P6b**: `style-axes.ts` mirror, `patchDesignStyle` in `theme-edit.ts`, axes added to the brief and tools, specimen added to the page picker.

### T3 — Rollout
1. Decide how the fleet rollout runs.
2. **Show the roster and ask** before touching any repo.
3. New sites pick up the template changes automatically through `template-seed.ts`.

### P7 — A/B + retirement
- `scripts/compare-design-models.ts` (Opus 5.5 vs Fable 5.1, side-by-side HTML report, cost and latency).
- After about 5 proven clients and your sign-off:
  - delete `export-brief` from the template;
  - update CLAUDE.md (tier map, storage prefix, Design Studio rules) and the design-brief memory.

---

## Critical files

- **Modify:**
  - `app/api/edit/[id]/theme/{route.ts,chat/route.ts,shell/route.ts}`
  - `lib/editor/theme-edit.ts`
  - `lib/theme-preview/compose-srcdoc.ts`
  - `components/editor/{ThemeStudio,ThemePreview}.tsx`
  - `lib/content/{generation-tuning,token-pricing,json-generation,cache-control}.ts`
  - `app/api/cron/sweep-stuck-jobs/route.ts`
  - `next.config.ts`, `vercel.json`, `package.json`
- **Create:**
  - `lib/design/**`
  - `app/api/edit/[id]/design/**`
  - `components/design-studio/**`
  - `supabase/078_design_studio.sql`
  - `lib/content/font-module-generator.ts` + golden fixture
  - `scripts/compare-design-models.ts`
- **Template:**
  - `src/app/layout.tsx`, `src/app/globals.css`, `src/lib/theme/types.ts`
  - new `c5-template.json`, `font-manifest.ts`, `generate-fonts.ts`, `fonts.generated.ts`, `style-axes.css`, `design-specimen/page.tsx`
  - port content from `scripts/export-design-brief.ts`

## Verification

- **Every phase:** `npx tsc --noEmit`, `npm test`, `npm run lint`, `npm run build`, and the three CLAUDE.md greps (service role, GitHub key, console.log).
- **Unit tests:**
  - sanitizer (40+ cases, LightningCSS failure, marker round-trip);
  - bundle round-trip against the Korbey fixture (`theme.css` equals the golden);
  - `setHtmlAttributes` escaping;
  - shell path traversal (`%2F..`, `//evil`, other origin);
  - brief prefix byte-stability, which protects the cache, and no `_meta` / `mbp_content`;
  - concept generator repair and rejection;
  - critic pass rule and loop termination (pass, cap, null, cost);
  - version_no retry on 23505;
  - gate matrix: admin 200, member / editor / owner 403, bad bearer 401, empty CRON_SECRET 500.
- **P0:** toggling a treatment in Theme Studio now changes the preview.
- **P1:** measure cold start and render latency on a Vercel preview deploy.
- **P3 / P4 end-to-end on a test client** (for example bblcpa):
  1. Add inputs.
  2. Generate 3 concepts.
  3. Confirm that a deliberately timid concept gets flagged and revised.
  4. Apply → v1 on draft.
  5. The Changes panel shows diffs for brand.json, design.json, theme.css and overrides.
  6. The draft Vercel build succeeds.
  7. Publish.
  8. Check that run `cost_usd` is within about 5% of the Token Usage dashboard.
- **P5:** annotate "make these cards calmer" → the AI renders, adjusts and commits v3 → restore v1 → v4 matches v1's diff.
- **T1 / T2:**
  - the template CI builds every manifest font;
  - an untouched `design.json` renders byte-identically;
  - Playwright screenshot diffs for each axis value.

## Risks to watch

1. Chromium bundling and memory on Vercel. Handled by the P1 go/no-go gate and the provider interface.
2. Override CSS or the fonts module breaking a client build. Handled by LightningCSS validation and the font CI job; Vercel also keeps the last good production deploy.
3. Preview/live drift: the shell is `main` but writes go to draft. Handled by capability intersection plus a banner.
4. Publishing ships all of draft, so design changes go out together with any pending content edits.
5. Stale fleet roster.
6. Applying a design to sites with the `theme.css` gap will visibly change their live look on publish.

**Still to confirm:** the exact Fable 5.1 id and price, Fluid 800 s / 3 GB for these functions, and whether to expand `CURATED_FONTS` now that fonts reach the live site.
