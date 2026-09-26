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
- **`applied_blobs` contract:** MUST be the full post-apply blob-sha map for all four theme files, plus `src/app/fonts.generated.ts` on L2+ drafts (`content/brand.json`, `content/design.json`, `src/styles/theme.css`, `content/design-overrides.css`, `src/app/fonts.generated.ts`), omitting any file that no longer exists after apply — drift compares this map to the live draft, so partial maps show as drifted immediately.

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
- **Accepted deviations (recorded 2026-09-25):**
  - With no `c5-template.json`, a site is **L1**, so treatments count as a base lever. They shipped fleet-wide on 09-08. Fonts stay locked until L2, and style axes until L3.
  - Resolved in P6a: capabilities are draft ∩ live-shell meta.
  - **Keep-legacy concept applies are refused when the draft has hand CSS outside the region** (09-26 audit). Concept renders compose with legacy CSS removed, so the apply gate never measured a kept-legacy composition. Rather than re-render at apply time, `commitDesignVersion` 422s that case; with no legacy CSS the two compositions are identical and keep-legacy applies normally.
  - **The managed region has a 16 KB / 400-line total cap** on top of the per-fragment caps, enforced in `bundleToRepoFiles` (09-26 audit).
  - **No commit without a v0 baseline** (09-26 audit): if the baseline import failed, every commit path 409s until the draft is fixed, so a concept or chat commit can never become v0.
  - MBP data enters the prompt only through `buildBrandVoiceBlock` / `buildFirmContext`, not `serializeSchema()`, which is private to the onboarding chat. The hygiene is the same: no `_meta`, no `mbp_content`, and a test checks nothing leaks.
  - Concepts render **one after another**, one per step invocation, because the single-process Chromium renderer handles one render at a time anyway.
  - The render pass reuses the `refining` status (migration 078 has no `rendering`).
  - The first Opus call may use up to 500 s of the step's 540 s generation budget. An aborted call adds an estimated input cost to the run's `cost_usd`, so the cap stays honest.
  - The axe AA, mobile-overflow and hidden-block apply gates arrive with P4. P3 gates on zod, capability tier, the sanitizer, `checkThemeContrast` and the sha guards.

### P4 — Vision critique loop
- `critic.ts`, `metrics.ts` (axe, overflow, hidden) and `distinctness.ts` (ΔE via chroma-js).
- Rubric scored 1–5: brandFit, distinctiveness, hierarchy, legibility, consistency, craft.
- Pass rule: all ≥3, mean ≥3.8, distinctiveness ≥4.
- UI: CritiqueView and BeforeAfter.
- **Accepted deviations (recorded 2026-09-25):**
  - **No axe-core.** The renderer's CSP blocks a script tag, and axe would be roughly 0.5 MB evaluated on every render. Our own in-page checks run over CDP instead: WCAG AA contrast (4.5:1 normal, 3:1 large text), overflow at 390 px, and hidden, zero-size or off-screen `[data-block]` elements. Text on an image, or in a colour that can't be parsed, counts as unverified and is not failed.
  - **Gates compare against the current site.** A failure blocks apply only if the current site doesn't already have it. The diff uses the full, uncapped set of contrast failure keys. If any viewport went unmeasured, apply is allowed with a warning per viewport.
  - **Default cost cap is $6 per run** (user decision). `DEFAULT_RUN_COST_CAP_USD` is written explicitly when a run is created, and the database default of 4 is unused. A typical run costs about $2–5.
  - **Revise calls are recorded as `design_concept`;** critique calls are recorded as `design_critique`.
  - **One model call per step invocation** (render, critique or revise). Concepts loop one at a time. Loop state and metrics live in `design_concepts.critique`. Claims are compare-and-set on status plus `updated_at`.
  - **Retry resumes only the first concept that was mid-loop,** and parks the others as `pending` with their review kept.
  - **Revise gets a CSS budget and one size-only repair.** The revise prompt's per-call part lists each block's line count against its cap. A revision rejected only for exceeding a size cap gets exactly one repair turn, under the same cost, deadline and floor rules as P3's repair. The live E2E showed revisions otherwise overshooting the 60-line block cap.

### P5 — Revision chat with vision
- `design/chat` route on Sonnet 5, `chatProviderOptions('medium')`, cached stable system block plus a dynamic bundle block.
- Tools: set_palette / fonts / tokens / treatments / style_axes / block_css, remove_block_css, `render_preview` (returns an image via `toModelOutput`, at most 2 per turn) and `commit_version`.
- `onFinish` auto-commits anything staged.
- Attachments route, AnnotateCanvas (boxes, arrows, pins), and version restore/import routes.
- **Replaces the old ThemeChat.**
- **Accepted deviations (recorded 2026-09-25):**
  - Resolved in P6b: set_style_axes (refused below L3).
  - **Staged edits live only within a turn.** Each turn commits them or reports why not in a `data-design-commit` part, and the next turn's context repeats that note. A stream error or hard-deadline abort discards staged edits. The chat has no migration and no cross-turn staging.
  - **Chat commits never sync the MBP** (CLAUDE.md MBP rule). Human-clicked paths still sync: concept apply, restore, Controls, and the Versions panel's **Sync palette & fonts to MBP** (`POST design/sync-mbp`, added in the 09-26 audit), which mirrors the whole draft. Capture records a version only; it never synced.
  - **Chat commits keep hand CSS** (`removeLegacy: false`). They pass the workspace's expected blob shas, so the sha guard is the only staleness check and two commits per turn work.
  - **Chat render gate:** it diffs against the turn-start draft render, cached per turn. Unmeasured or incomplete viewports produce a warning, not a block. A **failed** preview is sticky (09-26 audit): later edits can't be committed — by `commit_version` or the auto-commit — until a preview of a newer revision passes. An unpreviewed change with no failed preview behind it still commits with the "not previewed" warning.
  - **Route limits:** `maxDuration` 600 and a 540 s turn budget. The model stops at the commit reserve, and there is a hard abort at the deadline.
  - **Cost:** a turn costs about $0.10–0.15 with previews. Previews are stored under `design/{sid}/renders/chat/`.
  - **Clear chat removes its preview renders except those a version uses as a thumbnail** (09-26 audit; it used to keep them all). Two tabs have no lock; the second commit gets a stale 409.
  - **Restoring a baseline or captured version writes its recorded `design-overrides.css` back verbatim** (read by the blob sha in `applied_blobs`), so hand CSS removed by a later apply returns. Other restores keep the current hand CSS and warn when the file differs from the version's.
  - **Storage orphans** (`/design/render` outputs, never-sent attachments) are removed hourly by the sweep cron after a day.
  - **No per-function memory in `vercel.json`** for the Chromium routes (P1 listed 3009 MB). The P1 smoke passed on the default size, and a per-function memory setting depends on the Vercel plan / Fluid compute configuration, so it is left to the project's dashboard setting. Revisit if a render OOMs.

### T1 — Template: marker + fonts module + accentFont
Platform follow-up **P6a**: font generator golden, manifest parity test, fonts unlocked at L2.

- **Accepted deviations (recorded 2026-09-26, T1 + P6a):**
  - **"Byte-identical" = identical pixels.** next/font class hashes change when the calls move into `fonts.generated.ts`. R1 is enforced by a local Playwright pixel baseline (captured on `a540d1e`), a vitest pin of the default module text, an untouched `theme.css`, and no default `data-c5-*` attributes.
  - **The fonts module is a committed artifact** (like `theme.css`). There is no prebuild regeneration, and template CI's `generate-fonts --check` guards drift. The platform regenerates it on EVERY theme write to an L2+ draft, so a stale module (e.g. a fleet-seeded default) changes the live fonts on the next publish. The Versions panel warns (`fontsModuleStale`).
  - **Two capability reads.** Gates use draft ∩ live-shell meta. File-contract decisions (write/guard the module, `applied_blobs`, drift paths) use the draft marker. A shell without the meta = L1. An unreachable shell = draft tier, flagged `unverified`. Verified reads are cached 60 s.
  - **`applied_blobs` = four theme files, plus `src/app/fonts.generated.ts` on L2+ drafts.** Drift compares the module only once a version recorded it, so pre-P6a versions don't show a false drift.
  - **Preview font vars are `!important`**, so a chosen body font beats the template's inline `--font-body-loaded` alias.
  - **First package deploy writes the theme files (Task 18b).** The deliverable push now adds `src/styles/theme.css` (generateThemeCss) and, when the draft `c5-template.json` declares `fonts`, `src/app/fonts.generated.ts` (SYNCED, from design.json) — both site config (`SITE_CONFIG_PATHS`): written on the first deploy, created if absent later, never overwritten once present. A deployed draft that is missing one gets it recreated from the PACKAGE brand/design, not the draft's. `content/.template-default` is never seeded into client repos.
  - **Pre-cutover sites whose `preview_url` is unset resolve the shell to the client's OLD live site,** which lacks the meta ⇒ L1 (fonts/axes locked) until `preview_url` points at the new site.

### T2 — Template: style axes + specimen
Platform follow-up **P6b**: `style-axes.ts` mirror, `patchDesignStyle` in `theme-edit.ts`, axes added to the brief and tools, specimen added to the page picker.

- **Accepted deviations (recorded 2026-09-26, T2 + P6b):**
  - **Hooks:** besides `data-c5="button"` and the headline accent span (`data-c5="headline-accent"`, on all four accent spans), two more inert hooks: `data-c5="media-grade"` (FramedMedia overlay) and `data-c5-spacing` (Section padding). The accent's inline colour is kept, so accent-usage presets use `!important` in template CSS.
  - **Attributes are prefixed** `html[data-c5-<axis>]`. v1 values: sectionRhythm compact|generous; cards flat|outlined|elevated; buttons pill|sharp|bold; heroScale compact|dramatic; imageTreatment natural|mono|rounded; nav bordered|inverted; footer light|brand; accentUsage subtle|plain|underline.
  - **`DesignBundle.style` is canonical** (defaults dropped; absent = all default). Apply writes the whole axis set, deleting `design.json.style` when all default. Below L3 it is stripped by the generator and rejected on apply.
  - **The brief's CSS rules stay byte-stable.** Axis attributes are advertised in the tier-dependent levers section only. The sanitizer accepts them at every tier (they match nothing on older templates).
  - **Specimen robots:** `noindex` meta + `X-Robots-Tag`. It is deliberately NOT disallowed in robots.txt (that would hide the noindex).
  - **`nav=inverted` re-scopes the active nav item and the nav CTA** (light-on-primary) and restores popover colours inside the bar; covered by an interior-page e2e.
  - **`fontsModuleStale` is also true for a fleet-seeded DEFAULT module** (its header marks it unsynced); the Versions panel notice shows until the next Studio apply/chat commit/Controls change regenerates it.

**Live E2E checklist (post-T3)** (on a test client after T3 puts a T2 template on its draft AND main):
1. The Studio state shows L4 (runs snapshot `capabilities.level === 4`, `shell: 'verified'`).
2. Chat: "use Lora for headings" → commit → the Changes panel shows `design.json` + `src/app/fonts.generated.ts`, and the draft build succeeds.
3. Chat: "make the cards flat and the nav inverted" → the preview shows it → commit → `design.json.style` is set.
4. Pick "Block specimen" in the page picker → run 2 concepts → renders show every block.
5. On an L1 client: `set_fonts` / `set_style_axes` are refused; no fonts module path in `applied_blobs`.

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
6. Applying a design to sites with the `theme.css` gap will visibly change their live look on publish. (Resolved 2026-09-26: Task 18b makes the first package deploy write missing theme files — see T1's accepted deviations.)

**Still to confirm:** the exact Fable 5.1 id and price, Fluid 800 s / 3 GB for these functions, and whether to expand `CURATED_FONTS` now that fonts reach the live site.

## Open items (not in this plan)

- **T3 rollout.** The fleet sync must:
  - treat `src/app/fonts.generated.ts` as seed-if-absent (the template DEFAULT file, verbatim);
  - never overwrite `content/design.json` or `content/design-overrides.css`;
  - write `c5-template.json` last;
  - show the reconciled roster first.
- **Controls tab UI.** Theme Studio Controls could expose the style axes via `patchDesignStyle` (the theme PATCH route doesn't accept `style` yet).
