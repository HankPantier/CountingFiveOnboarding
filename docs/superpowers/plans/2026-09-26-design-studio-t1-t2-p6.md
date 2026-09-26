# Design Studio T1 + T2 (template) and P6a + P6b (platform) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the client template real, live levers for fonts, style axes and a block specimen page (T1, T2). Then teach the platform's Design Studio to drive those levers (P6a, P6b). An untouched site must render exactly as it does today.

**Architecture:**
- **T1 (template).** A generated next/font module (`src/app/fonts.generated.ts`) replaces the hardcoded fonts in `layout.tsx`. A pure generator (`src/lib/theme/font-module.ts`) builds it from `design.json.typography` over a curated manifest. `c5-template.json` declares the capabilities, and `layout.tsx` repeats them in `<meta name="c5-capabilities">`. A CI job builds every manifest font once.
- **T2 (template).** `design.json.style` maps to `<html data-c5-*>` attributes. They drive `src/styles/style-axes.css`, whose every rule is gated on one of those attributes, so an untouched site matches nothing. `/design-specimen` renders the first real instance of every block, falling back to samples.
- **P6a (platform).** A byte-parity port of the font-module generator, with golden fixtures. Capabilities become draft marker ∩ deployed-shell meta. The fonts module joins the sha-guarded theme write path and `applied_blobs`, but only for sites whose DRAFT template supports fonts (L2+).
- **P6b (platform).** A style-axes mirror with a parity fixture, `patchDesignStyle`, `DesignBundle.style`, axes in the brief and a `set_style_axes` chat tool, and the specimen in the page picker.

**Tech Stack:**
- Template: Next.js 16.2.7 (App Router, `cacheComponents: true`, `proxy.ts`), React 19.2, Tailwind v4 (`@theme`), vitest 4 (`src/**/*.test.ts`, node env), Playwright 1.60 (`e2e/`, against `npm run start`), tsx scripts.
- Platform: Next.js 16 (App Router), TypeScript strict, vitest 4, zod 4, Vercel AI SDK 6 (`tool`), GitHub App repo-files helpers.

**Spec:** `docs/superpowers/specs/2026-09-24-design-studio-design.md`. Read:
- §Template changes (items 1–5);
- §Phased delivery → **T1**, **T2**, **T3**, and every "Accepted deviations" block (P3, P4, P5);
- §Data model → the `applied_blobs` contract;
- §Verification → **T1 / T2**.

Prior plans that set the platform conventions: `docs/superpowers/plans/2026-09-24-design-studio-p0-foundations.md` … `2026-09-25-design-studio-p5-chat.md`.

## Global Constraints

**Repos and branches**
- Template tasks ([TEMPLATE]) run in `/Users/webhank/LocalSites/counting-five-client-template` on branch `feat/design-studio-t1-t2` (already checked out, based on `a540d1e`).
- Platform tasks ([PLATFORM]) run in `/Users/webhank/LocalSites/counting-five-onboarding` on a NEW branch `feat/design-studio-p6`, cut from `master` AFTER `fix/full-audit-0926` has merged. Do not start platform work on the audit branch.
- Order: T1 (Tasks 1–7), then P6a (Tasks 15–19), then T2 (Tasks 8–14), then P6b (Tasks 20–24), then the docs (Task 25). P6a can start once Task 7 is committed, because its golden fixtures are copied from the template. P6b needs Task 8's `docs/design/style-axes.json`.
- **Never stage `CLAUDE.md`** in either repo. `next dev` rewrites the onboarding `CLAUDE.md` (see its tail), so always use `git add <explicit paths>`, never `git add -A` or `git add .`.

**Commits**
- Template commit messages start `feat(theme): …` (or `fix(theme): …` / `test(theme): …` / `ci(theme): …` for the harness, redirect and CI tasks).
- Platform commit messages start `feat(design-studio): …` (or `fix(design-studio): …`).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

**R1 — zero visual change for existing sites (binding)**
- An untouched `design.json` must render identically.
- `src/styles/theme.css` and `scripts/generate-theme.ts` are NOT modified (`git diff a540d1e -- src/styles/theme.css scripts/generate-theme.ts` must stay empty). The platform `theme.css.golden` and `theme-css-generator.ts` are NOT modified.
- The default `fonts.generated.ts` loads exactly today's fonts: Public Sans 400/500/700 on `--font-heading-loaded`, aliased to `--font-body-loaded`; Fraunces 400/500 normal+italic on `--font-accent-loaded`; Geist Mono 400/500 on `--font-mono-loaded`; all `subsets: ['latin']`, `display: 'swap'`, in that className order.
- `<html>` gets NO `data-c5-*` attribute unless `design.json.style` sets a non-default value.
- The only default-state DOM change is a few inert hook attributes (`data-c5="button"`, `data-c5="headline-accent"`, `data-c5="media-grade"`, `data-c5-spacing`). No stylesheet other than `src/styles/style-axes.css` may reference `data-c5` (a test enforces this).
- Checks: the Task 1 Playwright pixel baseline (`@visual`) re-run after T1 and after T2 with zero diffs; the CI `design-defaults` e2e; and the vitest parity tests.

**R2 — capability tokens**
- After T1, `c5-template.json` is exactly `{"templateVersion": "2026.09.1", "capabilities": ["fonts"]}`.
- After T2, it is exactly `{"templateVersion": "2026.09.2", "capabilities": ["fonts", "style-axes", "specimen"]}`.
- The tokens are the exact strings the platform already uses (`CAPABILITY_FONTS` / `CAPABILITY_STYLE_AXES` / `CAPABILITY_SPECIMEN` in `lib/design/capabilities.ts`).

**R3 — the fonts module file contract**
- Path: `src/app/fonts.generated.ts` (platform constant `FONTS_MODULE_PATH`).
- Fleet rollout (T3): excluded from overwrite, seeded if absent with the template's DEFAULT file verbatim (today's fonts, so R1 holds). `c5-template.json` is written LAST in any rollout commit.
- The platform derives it in `bundleToRepoFiles`, writes it in `applyBundleToDraft` and in the Theme Studio Controls route, and sha-guards it like the other theme files.
- `applied_blobs` includes it ONLY when the draft marker declares `fonts`. This changes the four-file contract to "four files, plus the fonts module on L2+ drafts" (Task 18).

**R4 — CI builds every manifest font once**
- A separate, parallel `fonts` job generates an all-fonts module (`--all`) and runs `next build` only (no lint, tests or e2e). It uses the npm cache plus a `.next/cache` cache.

**R5 — security and performance**
- CSP `font-src 'self'` is unchanged (next/font self-hosts).
- `/design-specimen` is a static server component built only from `'use cache'` loaders, so it prerenders. It carries `robots: noindex,nofollow` metadata plus an `X-Robots-Tag: noindex, nofollow` header. It is not in the sitemap or llms.txt, not linked, and renders its content with JavaScript disabled.
- `robots.txt` deliberately does NOT `Disallow` it: a disallowed URL is never fetched, so its `noindex` would never be seen, and the deliverable overwrites `public/robots.txt` anyway.

**R7 — redirects hardening**
- `content/redirects.csv` destinations starting `//` or `/\`, or containing control characters, are skipped with a warning.

**Verification commands**
- Template: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run validate`, `npm run build`, `npm run test:e2e`.
- Platform: `npx tsc --noEmit`, `npm test`, `npm run lint`, `npm run build`, plus the CLAUDE.md greps before every commit:
  - `grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app` → nothing;
  - `grep -r "GITHUB_APP_PRIVATE_KEY" ./app` → nothing;
  - `grep -rn "console\.log" ./app ./lib --include="*.ts" --include="*.tsx" --exclude="*.test.ts" --exclude="*.test.tsx"` → nothing.

**Platform rules (onboarding CLAUDE.md)**
- Every `app/api/edit/[id]/design/**` route calls `requireDesignAdmin(id)` first.
- 5xx responses go through `internalError`.
- No `as any`.
- No `console.log` in `app/` or `lib/` (use `console.warn` / `console.error`).
- Tool parameter descriptions stay under 50 words.
- Chat commits never sync the MBP.

---

## Rulings (decided while writing this plan)

1. **Hook attributes.** The spec names `data-c5="button"` and "the hero accent span". This plan adds four inert hooks:
   - `data-c5="button"` on `Button`;
   - `data-c5="headline-accent"` on the four headline accent spans (Hero, HeroSplit, PageHeader, IntroText);
   - `data-c5="media-grade"` on `FramedMedia`'s duotone overlay;
   - `data-c5-spacing` on `Section`'s padded element.

   The last two exist because the image-treatment and section-rhythm axes otherwise need brittle selectors on Tailwind class names. The accent span KEEPS its inline `color` (so client overrides behave exactly as today). The accent-usage axis therefore uses `!important`, which is allowed in template-owned CSS only.
2. **Axis attribute names are prefixed** `data-c5-<kebab-axis>` (for example `data-c5-cards`), not bare `data-cards`, to avoid collisions. Each axis has a `default` value that emits no attribute.
3. **v1 axis values** (including `default`):

   | Axis | Values |
   |---|---|
   | `sectionRhythm` | default, compact, generous |
   | `cards` | default, flat, outlined, elevated |
   | `buttons` | default, pill, sharp, bold |
   | `heroScale` | default, compact, dramatic |
   | `imageTreatment` | default, natural, mono, rounded |
   | `nav` | default, bordered, inverted |
   | `footer` | default, light, brand |
   | `accentUsage` | default, subtle, plain, underline |

4. **What "byte-identical" means here.** Moving the next/font calls to a new module changes next/font's hashed class names, so the HTML is not literally byte-identical. R1 is therefore enforced as:
   - identical pixels (the Task 1 Playwright baseline);
   - identical font calls (a vitest test pins the default module text);
   - untouched `theme.css`;
   - no default `data-c5-*` attributes.
5. **Fonts module semantics.**
   - The committed file is the artifact, like `theme.css`: no prebuild regeneration, and the template CI's `--check` step guards drift.
   - The platform regenerates it on EVERY theme write to an L2+ draft, even when fonts didn't change. That is the same semantics as `theme.css`: a stale module is corrected, which can change the live look on publish.
   - The Studio shows a "fonts module is out of date" notice (`fontsModuleStale`), mirroring `themeCssStale`.
6. **Capability reads.**
   - `readEffectiveCapabilities({githubRepo, jobId})` returns `{ draft, effective }`.
   - **Gates** use `effective` = draft marker ∩ shell meta: which levers a run, chat or commit may change.
   - **File-contract decisions** use `draft`: whether to write or guard the fonts module, and which paths `applied_blobs` and drift include. The file exists because the draft template has it.
   - A reachable shell without the meta counts as "no capabilities" (L1).
   - An unreachable shell falls back to draft-only (`shell: 'unverified'`), which is today's behaviour. It is safe: previews need the shell anyway, and the fonts preview uses Google Fonts, not the shell.
   - Verified shell reads are cached per site URL for 60 s; failures are not cached.
7. **`applied_blobs` compat (the four-file contract change).** `computeDrift` compares the fonts path only when the latest version's `applied_blobs` recorded it. Versions recorded before P6a therefore don't show a spurious drift on an L2 draft; the next version records it.
8. **Bundle `style` semantics.**
   - `DesignBundle.style` is canonical: default values are dropped, and it is `undefined` when all axes are default. An absent `style` means "all default".
   - `bundleToRepoFiles` writes the FULL axis set: it replaces `design.json.style`, deleting it when everything is default.
   - Below L3, `style` is stripped (generator) or rejected (apply), exactly like fonts below L2.
9. **The brief's CSS-rules section stays byte-stable.** `CSS_RULES_SECTION` keeps listing only the treatment attributes, via a new `TREATMENT_STATE_ATTRS`. The axis attributes appear in the tier-dependent levers section. The sanitizer accepts all of them through `HTML_STATE_ATTRS`.
10. **Preview body font.** `compose-srcdoc` marks its injected `--font-*-loaded` vars `!important`. Otherwise the shell's inline `<html style="--font-body-loaded: var(--font-heading-loaded)">` alias always wins, and a chosen body font never shows in previews (Task 19).

---

## File Structure

### Template (`counting-five-client-template`)

| File | Status | Responsibility |
|---|---|---|
| `e2e/zero-change.spec.ts` + `-snapshots/` | Create | `@visual` pixel baseline of today's pages (R1), local-only. |
| `e2e/design-defaults.spec.ts` | Create | CI: default `<html>` attributes, fonts, capability meta. |
| `playwright.config.ts` | Modify | `grepInvert: /@visual/` on CI. |
| `src/lib/redirects/parse-redirects-csv.ts` (+test) | Create | Pure `redirects.csv` parser + destination safety (R7). |
| `next.config.ts` | Modify | Use the parser; `X-Robots-Tag` for `/design-specimen`. |
| `src/lib/theme/font-manifest.ts` (+test) | Create | Curated font manifest (⊇ `CURATED_FONTS` + Geist Mono), defaults, JSON export. |
| `src/lib/theme/font-module.ts` (+test) | Create | Pure `generateFontsModule` / `generateAllFontsModule`. |
| `scripts/generate-fonts.ts` | Create | CLI: write / `--check` / `--all` / `--design --stdout`. |
| `scripts/generate-design-contracts.ts` | Create | Writes `docs/design/{font-manifest,style-axes}.json` + font golden fixtures. |
| `src/app/fonts.generated.ts` | Create (generated) | Default module = today's fonts. |
| `src/lib/theme/__fixtures__/fonts/*` | Create (generated) | Design fixtures + golden module texts shared with the platform. |
| `src/lib/theme/fonts-generated.test.ts` | Create | Committed module + goldens + docs JSON parity. |
| `src/app/layout.tsx` | Modify | Import the fonts module; capability meta; style-axis attributes. |
| `src/lib/theme/types.ts` | Modify | `typography.accentFont?`, `style?`. |
| `c5-template.json` | Create | Capability marker (R2). |
| `src/lib/theme/template-marker.ts` (+test) | Create | Typed marker import + meta content. |
| `.github/workflows/ci.yml` | Modify | `--check` step + `fonts` job (R4). |
| `src/lib/theme/style-axes.ts` (+test) | Create | Axis vocabulary + `styleAxisAttributes()` + JSON export. |
| `docs/design/style-axes.json`, `docs/design/font-manifest.json` | Create (generated) | Platform mirror sources. |
| `src/components/ui/button.tsx`, `blocks/Section.tsx`, `blocks/{Hero,HeroSplit,PageHeader,IntroText}.tsx`, `ui/framed-media.tsx` | Modify | Inert hooks. |
| `src/lib/theme/hooks.test.ts` | Create | Hook markup + "no CSS references data-c5 outside style-axes.css". |
| `src/styles/style-axes.css` | Create | All axis rules, each gated on `html[data-c5-*]`. |
| `src/lib/theme/style-axes-css.test.ts` | Create | Every selector gated; every non-default value covered. |
| `src/app/globals.css` | Modify | Import `style-axes.css` between `theme.css` and the overrides. |
| `e2e/style-axes.spec.ts` | Create | Each non-default axis value changes pixels on `/`. |
| `src/lib/showcase/samples.ts` (+test) | Create | Extracted `SAMPLE_CONTENT` + sample section/manifests. |
| `src/app/showcase/page.tsx` | Modify | Import samples (no behaviour change). |
| `src/lib/specimen/pick-instances.ts` (+test) | Create | Pure first-instance selection with sample fallback. |
| `src/lib/specimen/load-pages.ts` | Create | Cached page loading for the specimen. |
| `src/app/design-specimen/page.tsx` | Create | The specimen route. |
| `e2e/design-specimen.spec.ts` | Create | noindex, header, sitemap/llms exclusion, unlinked, no-JS render. |
| `CHANGELOG.md`, `docs/architecture.md` | Modify | Release notes + contracts section. |

### Platform (`counting-five-onboarding`)

| File | Status | Responsibility |
|---|---|---|
| `lib/content/font-manifest.ts` | Create | Byte-parity port of the template manifest. |
| `lib/content/font-module-generator.ts` (+test) | Create | Byte-parity port of `generateFontsModule`. |
| `lib/content/__fixtures__/font-manifest.template.json`, `fonts-*.golden.txt`, `design-fonts-*.json` | Create (copied) | Template goldens (drift guard). |
| `lib/design/shell-capabilities.ts` (+test) | Create | Parse `<meta name="c5-capabilities">`; cached shell read. |
| `lib/design/capabilities.ts`, `run-types.ts` | Modify | `capabilityLevel`, `intersectWithShell`, `shell` field, `specimenUnlocked`, style enforcement (P6b). |
| `lib/design/capabilities-read.ts` (+test) | Modify | `readEffectiveCapabilities`. |
| `lib/design/drift.ts`, `theme-snapshot.ts` | Modify | `FONTS_MODULE_PATH`, `SNAPSHOT_PATHS`, `themeFilePaths`, drift compat, `isFontsModuleStale`. |
| `lib/design/bundle-files.ts`, `apply-bundle.ts`, `commit-version.ts` | Modify | Fonts-module write path. |
| `app/api/edit/[id]/design/{route.ts,runs/route.ts,versions/import/route.ts,pages/route.ts}`, `lib/design/chat-turn.ts` | Modify | Effective caps / paths. |
| `app/api/edit/[id]/theme/route.ts` | Modify | Controls writes the fonts module on L2+ drafts. |
| `lib/design/studio-types.ts`, `components/design-studio/{DesignStudio,VersionsPanel}.tsx` | Modify | `fontsModuleStale` notice. |
| `lib/theme-preview/compose-srcdoc.ts` | Modify | `!important` font vars; axis attrs allowlist. |
| `lib/design/style-axes.ts` (+test), `lib/design/__fixtures__/style-axes.template.json` | Create | Axes mirror + parity. |
| `types/design-json.ts`, `lib/editor/theme-edit.ts` | Modify | `style?`; `patchDesignStyle`. |
| `lib/design/{bundle,chat-edits,chat-workspace,chat-tools,chat-ui,concept-validate,css-targets,composed-theme}.ts` | Modify | `style` lever end-to-end. |
| `lib/design/brief/{contract,index,chat-prompt}.ts` | Modify | Axes in the brief + chat prompt. |
| `lib/design/pages.ts`, `components/design-studio/PagePicker.tsx` | Modify | Specimen pick at L4. |
| `docs/superpowers/specs/2026-09-24-design-studio-design.md` | Modify | T1/T2/P6 accepted deviations. |

---

# Track T1 — Template: marker + fonts module + accentFont

### Task 1: [TEMPLATE] Zero-change harness — capture today's look before anything changes

**Files:**
- Create: `e2e/zero-change.spec.ts`
- Create: `e2e/design-defaults.spec.ts`
- Modify: `playwright.config.ts`
- Create (generated): `e2e/zero-change.spec.ts-snapshots/*.png`

**Interfaces:**
- Consumes: nothing (runs on the unmodified base `a540d1e`).
- Produces: the `@visual` baseline that Tasks 5, 7, 10 and 14 re-run with zero diffs; `e2e/design-defaults.spec.ts`, which Tasks 7 and 10 extend.

- [ ] **Step 1: Confirm the base is clean**

Run: `cd /Users/webhank/LocalSites/counting-five-client-template && git status --short && git log -1 --format=%h`
Expected: no output from status; `a540d1e`.

- [ ] **Step 2: Exclude `@visual` tests on CI**

In `playwright.config.ts`, add inside `defineConfig({ … })` directly after `reporter: …`:

```ts
  // @visual tests compare against screenshots captured on a developer machine
  // (font rasterisation differs per OS), so they are a local R1 gate only.
  grepInvert: process.env.CI ? /@visual/ : undefined,
```

- [ ] **Step 3: Write the pixel baseline spec**

Create `e2e/zero-change.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

/**
 * R1 zero-visual-change gate for the Design Studio template work (T1/T2).
 * Baselines were captured on a540d1e BEFORE the fonts module / style axes
 * landed. Re-run after each phase: any diff means an untouched site changed.
 * Local only (grepInvert on CI) — see playwright.config.ts.
 */
const PAGES = ['/', '/privacy-policy', '/pricing-calculator', '/this-page-does-not-exist']
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

for (const vp of VIEWPORTS) {
  for (const path of PAGES) {
    test(`@visual ${vp.name} ${path} is unchanged`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await page.evaluate(() => document.fonts.ready)
      const name = `${vp.name}${path === '/' ? '-home' : path.replace(/\//g, '-')}.png`
      await expect(page).toHaveScreenshot(name, { fullPage: true, animations: 'disabled' })
    })
  }
}
```

- [ ] **Step 4: Write the CI-safe defaults spec**

Create `e2e/design-defaults.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

/**
 * Default-state contract for an untouched design.json (R1). Runs on CI.
 * Extended by T1 (capability meta) and T2 (no data-c5-* on <html>).
 */
test('untouched site keeps the default <html> treatments and no style axes', async ({ page }) => {
  await page.goto('/')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-headline', 'sans')
  await expect(html).toHaveAttribute('data-eyebrow', 'standard')
  const names = await page.evaluate(() => document.documentElement.getAttributeNames())
  expect(names.filter((n) => n.startsWith('data-c5'))).toEqual([])
})

test('untouched site loads today’s fonts (Public Sans heading/body, Fraunces accent)', async ({ page }) => {
  await page.goto('/')
  const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
  expect(body).toMatch(/Public Sans/)
  const h1 = await page.evaluate(() => getComputedStyle(document.querySelector('h1') as Element).fontFamily)
  expect(h1).toMatch(/Public Sans/)
  const accent = page.locator('.font-accent').first()
  await expect(accent).toBeVisible()
  expect(await accent.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Fraunces/)
})
```

- [ ] **Step 5: Build and capture the baseline**

Run: `npm run build && npx playwright test e2e/zero-change.spec.ts --update-snapshots`
Expected: 8 tests pass and 8 PNGs are written under `e2e/zero-change.spec.ts-snapshots/` (names end `-chromium-darwin.png`).

- [ ] **Step 6: Re-run both specs without updating**

Run: `npx playwright test e2e/zero-change.spec.ts e2e/design-defaults.spec.ts`
Expected: 10 passed (a stable baseline). If a page flakes, add `mask: [page.locator('video')]` for that page only and re-capture. Do not raise the diff tolerance.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts e2e/zero-change.spec.ts e2e/design-defaults.spec.ts e2e/zero-change.spec.ts-snapshots
git commit -m "test(theme): zero-visual-change baseline for the Design Studio template work

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: [TEMPLATE] Harden redirects.csv destinations (R7)

**Files:**
- Create: `src/lib/redirects/parse-redirects-csv.ts`
- Create: `src/lib/redirects/parse-redirects-csv.test.ts`
- Modify: `next.config.ts` (the `readRedirectsCsv` + `parseCsvLine` functions)

**Interfaces:**
- Produces:
  - `parseRedirectsCsv(raw: string): { redirects: CsvRedirect[]; skipped: SkippedRedirect[] }`;
  - `redirectDestinationError(to: string): string | null`;
  - `type CsvRedirect = { source: string; destination: string; permanent: true }`;
  - `type SkippedRedirect = { line: string; reason: string }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/redirects/parse-redirects-csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseRedirectsCsv, redirectDestinationError } from './parse-redirects-csv'

describe('redirectDestinationError', () => {
  it.each(['/new', '/a/b?x=1', '/services/tax#top'])('accepts a same-site path %s', (to) => {
    expect(redirectDestinationError(to)).toBeNull()
  })
  it.each([
    ['https://evil.com', 'non-relative destination'],
    ['evil.com', 'non-relative destination'],
    ['//evil.com', 'protocol-relative destination'],
    ['//evil.com/path', 'protocol-relative destination'],
    ['/\\evil.com', 'protocol-relative destination'],
    ['/a\tb', 'control character in destination'],
    ['/a\u0000b', 'control character in destination'],
    ['/a\u007fb', 'control character in destination'],
  ])('rejects %j (%s)', (to, reason) => {
    expect(redirectDestinationError(to)).toBe(reason)
  })
})

describe('parseRedirectsCsv', () => {
  it('parses rows, skipping the header, comments and blank lines silently', () => {
    const raw = ['old_url,new_url', '# comment', '', '/old,/new', '"/a,b","/c,d"'].join('\n')
    expect(parseRedirectsCsv(raw)).toEqual({
      redirects: [
        { source: '/old', destination: '/new', permanent: true },
        { source: '/a,b', destination: '/c,d', permanent: true },
      ],
      skipped: [],
    })
  })
  it('skips unsafe destinations and reports why', () => {
    const raw = ['/x,https://evil.com', '/y,//evil.com', '/z,/\\evil.com', '/ok,/fine'].join('\n')
    const r = parseRedirectsCsv(raw)
    expect(r.redirects).toEqual([{ source: '/ok', destination: '/fine', permanent: true }])
    expect(r.skipped.map((s) => s.reason)).toEqual([
      'non-relative destination',
      'protocol-relative destination',
      'protocol-relative destination',
    ])
  })
  it('ignores rows missing a source or destination', () => {
    expect(parseRedirectsCsv('/only-source,\n,/only-dest').redirects).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/redirects/parse-redirects-csv.test.ts`
Expected: FAIL — cannot resolve `./parse-redirects-csv`.

- [ ] **Step 3: Implement the parser**

Create `src/lib/redirects/parse-redirects-csv.ts`. `parseCsvLine` moves VERBATIM from `next.config.ts`:

```ts
/**
 * Pure parser for content/redirects.csv (read by next.config.ts at build).
 * Destinations must be same-site paths: `/x` is fine; `//host` and `/\host`
 * are protocol-relative (browsers treat `\` as `/`), and control characters
 * can smuggle a scheme or split the Location header — all skipped.
 */
export type CsvRedirect = { source: string; destination: string; permanent: true }
export type SkippedRedirect = { line: string; reason: string }

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/

export function redirectDestinationError(to: string): string | null {
  if (!to.startsWith('/')) return 'non-relative destination'
  if (to.startsWith('//') || to.startsWith('/\\')) return 'protocol-relative destination'
  if (CONTROL_RE.test(to)) return 'control character in destination'
  return null
}

export function parseRedirectsCsv(raw: string): { redirects: CsvRedirect[]; skipped: SkippedRedirect[] } {
  const redirects: CsvRedirect[] = []
  const skipped: SkippedRedirect[] = []
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#')) continue
    if (line.startsWith('old_url,')) continue
    const [from, to] = parseCsvLine(line)
    if (!from || !to) continue
    const reason = redirectDestinationError(to)
    if (reason) {
      skipped.push({ line, reason })
      continue
    }
    redirects.push({ source: from, destination: to, permanent: true })
  }
  return { redirects, skipped }
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        out.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
  }
  out.push(cur)
  return out.map((c) => c.trim())
}
```

Note: `line.trim()` already strips trailing `\t`/`\r`, so a control character is only rejected when it sits INSIDE the destination. That is the case the test covers (`/a\tb`).

- [ ] **Step 4: Point `next.config.ts` at it**

In `next.config.ts`:
- add `import { parseRedirectsCsv } from './src/lib/redirects/parse-redirects-csv'` next to the `blog-config` import;
- DELETE `parseCsvLine`;
- replace the body of `readRedirectsCsv` after the `readFile` try/catch with:

```ts
  const { redirects, skipped } = parseRedirectsCsv(raw)
  for (const s of skipped) {
    console.warn(`[next.config] Skipping redirect (${s.reason}): ${s.line}`)
  }
  return redirects
```

- [ ] **Step 5: Run the tests, types and build**

Run: `npx vitest run src/lib/redirects/parse-redirects-csv.test.ts && npx tsc --noEmit && npm run build`
Expected: tests PASS; tsc clean; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/redirects/parse-redirects-csv.ts src/lib/redirects/parse-redirects-csv.test.ts next.config.ts
git commit -m "fix(theme): reject protocol-relative redirects.csv destinations

// and /\\ destinations passed the startsWith('/') check and shipped as an
open redirect. The parser moves to src/lib/redirects (unit-tested).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: [TEMPLATE] Font manifest + `accentFont` in the design type

**Files:**
- Create: `src/lib/theme/font-manifest.ts`
- Create: `src/lib/theme/font-manifest.test.ts`
- Modify: `src/lib/theme/types.ts`

**Interfaces:**
- Produces:
  - `type FontManifestEntry = { family: string; importName: string; weights: readonly string[]; italic: boolean }`;
  - `FONT_MANIFEST: readonly FontManifestEntry[]` (22 families, sorted by family);
  - `ROLE_WEIGHTS = ['400', '500', '700'] as const`;
  - `MONO_FAMILY = 'Geist Mono'`;
  - `DEFAULT_TYPOGRAPHY = { headingFont: 'Public Sans', bodyFont: 'Public Sans', accentFont: 'Fraunces' }`;
  - `fontManifestJson(): string`;
  - `DesignJson['typography']['accentFont']?: string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/theme/font-manifest.test.ts`. It validates the manifest against next/font's own font data, so a wrong weight or italic flag fails here and not in a client's build:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TYPOGRAPHY, FONT_MANIFEST, MONO_FAMILY, ROLE_WEIGHTS, fontManifestJson } from './font-manifest'

type FontData = Record<string, { weights: string[]; styles: string[]; subsets: string[] }>
const FONT_DATA = JSON.parse(
  readFileSync(path.join(process.cwd(), 'node_modules/next/dist/compiled/@next/font/dist/google/font-data.json'), 'utf-8'),
) as FontData

// Mirror of the platform's CURATED_FONTS (lib/content/type-pairing-catalog.ts).
// The manifest MUST be a superset — the platform only ever writes these.
const CURATED_FONTS = [
  'Bitter', 'DM Sans', 'DM Serif Display', 'Fraunces', 'IBM Plex Sans', 'IBM Plex Serif', 'Inter', 'Karla',
  'Libre Caslon Text', 'Libre Franklin', 'Lora', 'Manrope', 'Merriweather', 'Nunito', 'Nunito Sans', 'Open Sans',
  'Playfair Display', 'Plus Jakarta Sans', 'Public Sans', 'Source Sans 3', 'Source Serif 4',
]

describe('FONT_MANIFEST', () => {
  it('covers every curated font plus the mono family', () => {
    const families = FONT_MANIFEST.map((e) => e.family)
    for (const f of [...CURATED_FONTS, MONO_FAMILY]) expect(families).toContain(f)
  })
  it('is sorted and unique', () => {
    const families = FONT_MANIFEST.map((e) => e.family)
    expect(families).toEqual([...new Set(families)].sort())
  })
  it.each(FONT_MANIFEST.map((e) => [e.family, e] as const))('%s matches next/font font-data', (family, entry) => {
    const data = FONT_DATA[family]
    expect(data, `${family} missing from next/font`).toBeDefined()
    expect(data.subsets).toContain('latin')
    expect(entry.importName).toBe(family.replace(/ /g, '_'))
    expect(entry.weights).toEqual(ROLE_WEIGHTS.filter((w) => data.weights.includes(w)))
    expect(entry.weights.length).toBeGreaterThan(0)
    expect(entry.italic).toBe(data.styles.includes('italic'))
  })
  it('defaults reproduce today’s layout.tsx fonts', () => {
    expect(DEFAULT_TYPOGRAPHY).toEqual({ headingFont: 'Public Sans', bodyFont: 'Public Sans', accentFont: 'Fraunces' })
  })
  it('serialises deterministically', () => {
    const json = JSON.parse(fontManifestJson())
    expect(json).toEqual({ version: 1, defaults: DEFAULT_TYPOGRAPHY, mono: MONO_FAMILY, fonts: FONT_MANIFEST })
    expect(fontManifestJson().endsWith('\n')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/theme/font-manifest.test.ts`
Expected: FAIL — cannot resolve `./font-manifest`.

- [ ] **Step 3: Implement the manifest**

Create `src/lib/theme/font-manifest.ts`:

```ts
/**
 * The fonts a client site can load live (via the generated next/font module,
 * src/app/fonts.generated.ts). ⊇ the platform's CURATED_FONTS + the mono role.
 * `weights` = which of the role weights (400/500/700) the family ships;
 * `italic` = whether it ships an italic. Both are verified against next/font's
 * font-data.json by font-manifest.test.ts, and CI builds every entry once
 * (the `fonts` job). The platform keeps a byte-parity port
 * (onboarding lib/content/font-manifest.ts) checked against
 * docs/design/font-manifest.json.
 */
export type FontManifestEntry = {
  family: string
  importName: string
  weights: readonly string[]
  italic: boolean
}

export const ROLE_WEIGHTS = ['400', '500', '700'] as const
export const MONO_FAMILY = 'Geist Mono'
export const DEFAULT_TYPOGRAPHY = { headingFont: 'Public Sans', bodyFont: 'Public Sans', accentFont: 'Fraunces' } as const

const W3: readonly string[] = ROLE_WEIGHTS
const f = (family: string, weights: readonly string[], italic = true): FontManifestEntry => ({
  family,
  importName: family.replace(/ /g, '_'),
  weights,
  italic,
})

export const FONT_MANIFEST: readonly FontManifestEntry[] = [
  f('Bitter', W3),
  f('DM Sans', W3),
  f('DM Serif Display', ['400']),
  f('Fraunces', W3),
  f('Geist Mono', W3, false),
  f('IBM Plex Sans', W3),
  f('IBM Plex Serif', W3),
  f('Inter', W3),
  f('Karla', W3),
  f('Libre Caslon Text', ['400', '700']),
  f('Libre Franklin', W3),
  f('Lora', W3),
  f('Manrope', W3, false),
  f('Merriweather', W3),
  f('Nunito', W3),
  f('Nunito Sans', W3),
  f('Open Sans', W3),
  f('Playfair Display', W3),
  f('Plus Jakarta Sans', W3),
  f('Public Sans', W3),
  f('Source Sans 3', W3),
  f('Source Serif 4', W3),
]

export function fontManifestJson(): string {
  return JSON.stringify({ version: 1, defaults: DEFAULT_TYPOGRAPHY, mono: MONO_FAMILY, fonts: FONT_MANIFEST }, null, 2) + '\n'
}
```

- [ ] **Step 4: Add `accentFont` to the design type**

In `src/lib/theme/types.ts`, replace the `typography` member with:

```ts
  typography: {
    headingFont: string
    bodyFont: string
    /** Italic-serif accent role (Ink & Clay). Absent in older design.json files
     * → the generated fonts module uses the default (Fraunces). */
    accentFont?: string
    googleFontsUrl: string
  }
```

- [ ] **Step 5: Run the tests and types**

Run: `npx vitest run src/lib/theme/font-manifest.test.ts && npx tsc --noEmit`
Expected: PASS (26 tests); tsc clean. If a font-data assertion fails, fix the manifest entry to match next/font. Never change the test.

- [ ] **Step 6: Commit**

```bash
git add src/lib/theme/font-manifest.ts src/lib/theme/font-manifest.test.ts src/lib/theme/types.ts
git commit -m "feat(theme): curated font manifest verified against next/font data

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: [TEMPLATE] Pure fonts-module generator

**Files:**
- Create: `src/lib/theme/font-module.ts`
- Create: `src/lib/theme/font-module.test.ts`

**Interfaces:**
- Consumes (Task 3): `FONT_MANIFEST`, `FontManifestEntry`, `MONO_FAMILY`, `DEFAULT_TYPOGRAPHY`.
- Produces:
  - `type FontTypographyInput = { headingFont?: string; bodyFont?: string; accentFont?: string }`;
  - `generateFontsModule(t: FontTypographyInput): { source: string; warnings: string[] }`;
  - `generateAllFontsModule(): string`;
  - `ROLE_SPECS`.
- The generated module exports `fontVariables: string` and `fontAliases: CSSProperties`. The platform port (Task 15) must match this output byte for byte.

- [ ] **Step 1: Write the failing test**

Create `src/lib/theme/font-module.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FONT_MANIFEST } from './font-manifest'
import { generateAllFontsModule, generateFontsModule } from './font-module'

const DEFAULT_MODULE = [
  '// This file is generated by scripts/generate-fonts.ts from content/design.json.',
  '// Edit design.json (typography) and run `npm run generate-fonts` instead of editing it.',
  '// The Revaltus platform rewrites it when the site fonts change (Design Studio / Theme Studio).',
  '',
  "import type { CSSProperties } from 'react'",
  "import { Public_Sans, Fraunces, Geist_Mono } from 'next/font/google'",
  '',
  'const font0 = Public_Sans({',
  "  subsets: ['latin'],",
  "  weight: ['400', '500', '700'],",
  "  variable: '--font-heading-loaded',",
  "  display: 'swap',",
  '})',
  '',
  'const font1 = Fraunces({',
  "  subsets: ['latin'],",
  "  weight: ['400', '500'],",
  "  style: ['normal', 'italic'],",
  "  variable: '--font-accent-loaded',",
  "  display: 'swap',",
  '})',
  '',
  'const font2 = Geist_Mono({',
  "  subsets: ['latin'],",
  "  weight: ['400', '500'],",
  "  variable: '--font-mono-loaded',",
  "  display: 'swap',",
  '})',
  '',
  '/** next/font variable classes for <html className>. */',
  'export const fontVariables = `${font0.variable} ${font1.variable} ${font2.variable}`',
  '',
  '/** Roles sharing a family point at the loaded variable (applied as <html style>). */',
  'export const fontAliases: CSSProperties = {',
  "  '--font-body-loaded': 'var(--font-heading-loaded)',",
  '} as CSSProperties',
  '',
].join('\n')

describe('generateFontsModule', () => {
  it('reproduces today’s layout.tsx fonts for the default typography (R1)', () => {
    expect(generateFontsModule({ headingFont: 'Public Sans', bodyFont: 'Public Sans' })).toEqual({ source: DEFAULT_MODULE, warnings: [] })
    // accentFont absent (pre-Ink & Clay design.json) = Fraunces, silently.
    expect(generateFontsModule({}).source).toBe(DEFAULT_MODULE)
  })

  it('loads a shared family once, unions weights/italic and aliases the later role', () => {
    const { source } = generateFontsModule({ headingFont: 'Fraunces', bodyFont: 'Inter', accentFont: 'Fraunces' })
    expect(source).toContain("import { Fraunces, Inter, Geist_Mono } from 'next/font/google'")
    expect(source).toContain(
      "const font0 = Fraunces({\n  subsets: ['latin'],\n  weight: ['400', '500', '700'],\n  style: ['normal', 'italic'],\n  variable: '--font-heading-loaded',",
    )
    expect(source).toContain("variable: '--font-body-loaded'")
    expect(source).toContain("  '--font-accent-loaded': 'var(--font-heading-loaded)',")
    expect(source).not.toContain("'--font-body-loaded': 'var(")
  })

  it('drops italic for families without one and clamps weights to what ships', () => {
    const { source } = generateFontsModule({ headingFont: 'Manrope', bodyFont: 'DM Serif Display', accentFont: 'Manrope' })
    expect(source).not.toContain('italic')
    expect(source).toContain("const font1 = DM_Serif_Display({\n  subsets: ['latin'],\n  weight: ['400'],")
  })

  it('emits an empty alias map when every role has its own family', () => {
    const { source } = generateFontsModule({ headingFont: 'Lora', bodyFont: 'Inter', accentFont: 'Fraunces' })
    expect(source).toContain('export const fontAliases: CSSProperties = {}\n')
  })

  it('falls back per role on an unknown family, with a warning (never breaks a build)', () => {
    const r = generateFontsModule({ headingFont: 'Comic Neue', bodyFont: 'Inter', accentFont: 'Nope' })
    expect(r.warnings).toEqual(['Unknown heading font "Comic Neue" — using Public Sans.', 'Unknown accent font "Nope" — using Fraunces.'])
    expect(r.source).toContain("import { Public_Sans, Inter, Fraunces, Geist_Mono } from 'next/font/google'")
  })

  it('is deterministic', () => {
    const t = { headingFont: 'Source Serif 4', bodyFont: 'Source Sans 3', accentFont: 'Playfair Display' }
    expect(generateFontsModule(t).source).toBe(generateFontsModule({ ...t }).source)
  })
})

describe('generateAllFontsModule', () => {
  it('loads every manifest family exactly once with all of its weights', () => {
    const source = generateAllFontsModule()
    for (const [i, e] of FONT_MANIFEST.entries()) {
      expect(source).toContain(`const font${i} = ${e.importName}({`)
      expect(source).toContain(`variable: '--font-ci-${i}'`)
    }
    expect(source).toContain('export const fontAliases: CSSProperties = {}')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/theme/font-module.test.ts`
Expected: FAIL — cannot resolve `./font-module`.

- [ ] **Step 3: Implement the generator**

Create `src/lib/theme/font-module.ts`:

```ts
/**
 * Pure generator for src/app/fonts.generated.ts — the next/font module
 * layout.tsx imports. next/font requires literal, module-scope loader calls,
 * so fonts can only change live by regenerating this file (never a runtime
 * <link>: CSP font-src 'self', self-hosting and no-CLS all depend on it).
 *
 * Roles (in this order): heading, body, accent, mono. A family used by more
 * than one role is loaded ONCE (union of weights / italic) on the first role's
 * variable; later roles alias it via <html style> (today: body → heading).
 * Unknown families fall back to the role default with a warning.
 *
 * BYTE PARITY: the platform (onboarding lib/content/font-module-generator.ts)
 * ports this function; golden fixtures in src/lib/theme/__fixtures__/fonts/
 * are copied there. Change both together.
 */
import { DEFAULT_TYPOGRAPHY, FONT_MANIFEST, MONO_FAMILY, type FontManifestEntry } from './font-manifest'

export type FontRole = 'heading' | 'body' | 'accent' | 'mono'
export type FontTypographyInput = { headingFont?: string; bodyFont?: string; accentFont?: string }

type RoleSpec = { role: FontRole; variable: string; weights: readonly string[]; italic: boolean }
export const ROLE_SPECS: readonly RoleSpec[] = [
  { role: 'heading', variable: '--font-heading-loaded', weights: ['400', '500', '700'], italic: false },
  { role: 'body', variable: '--font-body-loaded', weights: ['400', '500', '700'], italic: false },
  { role: 'accent', variable: '--font-accent-loaded', weights: ['400', '500'], italic: true },
  { role: 'mono', variable: '--font-mono-loaded', weights: ['400', '500'], italic: false },
]

const HEADER_LINES = [
  '// This file is generated by scripts/generate-fonts.ts from content/design.json.',
  '// Edit design.json (typography) and run `npm run generate-fonts` instead of editing it.',
  '// The Revaltus platform rewrites it when the site fonts change (Design Studio / Theme Studio).',
]

type Load = { entry: FontManifestEntry; variable: string; weights: Set<string>; italic: boolean }

const entryFor = (family: string | undefined): FontManifestEntry | undefined =>
  FONT_MANIFEST.find((e) => e.family === family)

function resolveFamilies(t: FontTypographyInput): { families: Record<FontRole, FontManifestEntry>; warnings: string[] } {
  const warnings: string[] = []
  const pick = (role: FontRole, wanted: string | undefined, fallback: string): FontManifestEntry => {
    const found = entryFor(wanted)
    if (found) return found
    if (wanted) warnings.push(`Unknown ${role} font "${wanted}" — using ${fallback}.`)
    return entryFor(fallback) as FontManifestEntry
  }
  return {
    families: {
      heading: pick('heading', t.headingFont, DEFAULT_TYPOGRAPHY.headingFont),
      body: pick('body', t.bodyFont, DEFAULT_TYPOGRAPHY.bodyFont),
      accent: pick('accent', t.accentFont, DEFAULT_TYPOGRAPHY.accentFont),
      mono: entryFor(MONO_FAMILY) as FontManifestEntry,
    },
    warnings,
  }
}

const byWeight = (a: string, b: string): number => Number(a) - Number(b)

function renderCall(name: string, load: Load): string {
  const weights = [...load.weights].sort(byWeight)
  return [
    `const ${name} = ${load.entry.importName}({`,
    `  subsets: ['latin'],`,
    `  weight: [${weights.map((w) => `'${w}'`).join(', ')}],`,
    ...(load.italic ? [`  style: ['normal', 'italic'],`] : []),
    `  variable: '${load.variable}',`,
    `  display: 'swap',`,
    `})`,
  ].join('\n')
}

function renderModule(loads: Load[], aliases: [string, string][]): string {
  const variables = loads.map((_, i) => `\${font${i}.variable}`).join(' ')
  const aliasDecl =
    aliases.length === 0
      ? 'export const fontAliases: CSSProperties = {}'
      : [
          'export const fontAliases: CSSProperties = {',
          ...aliases.map(([v, target]) => `  '${v}': 'var(${target})',`),
          '} as CSSProperties',
        ].join('\n')
  return [
    ...HEADER_LINES,
    '',
    "import type { CSSProperties } from 'react'",
    `import { ${loads.map((l) => l.entry.importName).join(', ')} } from 'next/font/google'`,
    '',
    loads.map((l, i) => renderCall(`font${i}`, l)).join('\n\n'),
    '',
    '/** next/font variable classes for <html className>. */',
    `export const fontVariables = \`${variables}\``,
    '',
    '/** Roles sharing a family point at the loaded variable (applied as <html style>). */',
    aliasDecl,
    '',
  ].join('\n')
}

export function generateFontsModule(t: FontTypographyInput): { source: string; warnings: string[] } {
  const { families, warnings } = resolveFamilies(t)
  const loads: Load[] = []
  const aliases: [string, string][] = []
  for (const spec of ROLE_SPECS) {
    const entry = families[spec.role]
    const supported = spec.weights.filter((w) => entry.weights.includes(w))
    const existing = loads.find((l) => l.entry.family === entry.family)
    if (existing) {
      for (const w of supported) existing.weights.add(w)
      existing.italic = existing.italic || (spec.italic && entry.italic)
      aliases.push([spec.variable, existing.variable])
      continue
    }
    loads.push({
      entry,
      variable: spec.variable,
      weights: new Set(supported.length > 0 ? supported : [entry.weights[0]]),
      italic: spec.italic && entry.italic,
    })
  }
  return { source: renderModule(loads, aliases), warnings }
}

// CI only (the `fonts` job): every manifest family once, all its weights, so a
// `next build` proves each family resolves. Never committed.
export function generateAllFontsModule(): string {
  const loads: Load[] = FONT_MANIFEST.map((entry, i) => ({
    entry,
    variable: `--font-ci-${i}`,
    weights: new Set(entry.weights),
    italic: entry.italic,
  }))
  return renderModule(loads, [])
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/theme/font-module.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme/font-module.ts src/lib/theme/font-module.test.ts
git commit -m "feat(theme): pure next/font module generator (default = today's fonts)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: [TEMPLATE] `generate-fonts` script, committed default module, layout switch, contracts + goldens

**Files:**
- Create: `scripts/generate-fonts.ts`
- Create: `scripts/generate-design-contracts.ts`
- Create (generated): `src/app/fonts.generated.ts`, `docs/design/font-manifest.json`, `src/lib/theme/__fixtures__/fonts/{design-editorial.json,design-noitalic.json,fonts-default.golden.txt,fonts-editorial.golden.txt,fonts-noitalic.golden.txt}`
- Create: `src/lib/theme/fonts-generated.test.ts`
- Modify: `src/app/layout.tsx`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `generateFontsModule`, `generateAllFontsModule` (Task 4); `fontManifestJson` (Task 3).
- Produces:
  - `npm run generate-fonts` (flags `--check`, `--all`, `--design <path> --stdout`);
  - `npm run design-contracts`;
  - `src/app/fonts.generated.ts` exporting `fontVariables` and `fontAliases`;
  - the golden fixtures Task 15 copies.

- [ ] **Step 1: Create the two fixture designs**

Create `src/lib/theme/__fixtures__/fonts/design-editorial.json` (shared family: accent = heading):

```json
{
  "typography": {
    "headingFont": "Fraunces",
    "bodyFont": "Inter",
    "accentFont": "Fraunces",
    "googleFontsUrl": "https://fonts.googleapis.com/css2?family=Fraunces:wght@400;500;700&family=Inter:wght@400;500;700&display=swap"
  }
}
```

Create `src/lib/theme/__fixtures__/fonts/design-noitalic.json` (no-italic accent, single-weight body):

```json
{
  "typography": {
    "headingFont": "Manrope",
    "bodyFont": "DM Serif Display",
    "accentFont": "Manrope",
    "googleFontsUrl": "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700&family=DM+Serif+Display:wght@400;500;700&display=swap"
  }
}
```

- [ ] **Step 2: Write the failing parity test**

Create `src/lib/theme/fonts-generated.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fontManifestJson } from './font-manifest'
import { generateFontsModule } from './font-module'

const root = process.cwd()
const read = (p: string) => readFileSync(path.join(root, p), 'utf-8')
const FIX = 'src/lib/theme/__fixtures__/fonts'

describe('committed fonts module + contracts', () => {
  it('src/app/fonts.generated.ts matches content/design.json (run npm run generate-fonts)', () => {
    const design = JSON.parse(read('content/design.json'))
    expect(read('src/app/fonts.generated.ts')).toBe(generateFontsModule(design.typography ?? {}).source)
  })
  it('the default golden is exactly the committed default module', () => {
    expect(read(`${FIX}/fonts-default.golden.txt`)).toBe(read('src/app/fonts.generated.ts'))
  })
  it.each(['editorial', 'noitalic'])('the %s golden matches the generator', (name) => {
    const design = JSON.parse(read(`${FIX}/design-${name}.json`))
    expect(read(`${FIX}/fonts-${name}.golden.txt`)).toBe(generateFontsModule(design.typography).source)
  })
  it('docs/design/font-manifest.json matches the manifest (run npm run design-contracts)', () => {
    expect(read('docs/design/font-manifest.json')).toBe(fontManifestJson())
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run src/lib/theme/fonts-generated.test.ts`
Expected: FAIL — ENOENT for `src/app/fonts.generated.ts`.

- [ ] **Step 4: Write `scripts/generate-fonts.ts`**

```ts
#!/usr/bin/env tsx
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { generateAllFontsModule, generateFontsModule } from '../src/lib/theme/font-module'

/**
 * Regenerate src/app/fonts.generated.ts from content/design.json.
 *   (no flags)            write the module
 *   --check               exit 1 when the committed module is stale (CI)
 *   --all                 write a module loading EVERY manifest font (CI `fonts` job only — never commit)
 *   --design <p> --stdout print the module for another design.json (golden fixtures)
 */
const OUT = path.join(process.cwd(), 'src', 'app', 'fonts.generated.ts')

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--all')) {
    await fs.writeFile(OUT, generateAllFontsModule(), 'utf-8')
    console.log(`✓ Wrote ${OUT} with every manifest font (CI only — do not commit)`)
    return
  }
  const i = args.indexOf('--design')
  const designPath = i >= 0 && args[i + 1] ? args[i + 1] : path.join(process.cwd(), 'content', 'design.json')
  const design = JSON.parse(await fs.readFile(designPath, 'utf-8')) as { typography?: Record<string, string> }
  const { source, warnings } = generateFontsModule(design.typography ?? {})
  for (const w of warnings) console.warn(`[generate-fonts] ${w}`)
  if (args.includes('--stdout')) {
    process.stdout.write(source)
    return
  }
  if (args.includes('--check')) {
    const current = await fs.readFile(OUT, 'utf-8').catch(() => '')
    if (current !== source) {
      console.error('✗ src/app/fonts.generated.ts is stale — run `npm run generate-fonts` and commit it.')
      process.exit(1)
    }
    console.log('✓ src/app/fonts.generated.ts matches content/design.json')
    return
  }
  await fs.writeFile(OUT, source, 'utf-8')
  console.log(`✓ Wrote ${OUT}`)
}

main().catch((err) => {
  console.error('Error generating fonts module:', err)
  process.exit(1)
})
```

- [ ] **Step 5: Write `scripts/generate-design-contracts.ts`**

```ts
#!/usr/bin/env tsx
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fontManifestJson } from '../src/lib/theme/font-manifest'
import { generateFontsModule } from '../src/lib/theme/font-module'

/**
 * Writes the machine-readable contracts the Revaltus platform mirrors (and
 * parity-tests against): docs/design/font-manifest.json, and the golden fonts
 * modules under src/lib/theme/__fixtures__/fonts/. Task 8 adds style-axes.json.
 */
const root = process.cwd()
const FIX = path.join(root, 'src', 'lib', 'theme', '__fixtures__', 'fonts')

async function main(): Promise<void> {
  await fs.mkdir(path.join(root, 'docs', 'design'), { recursive: true })
  await fs.writeFile(path.join(root, 'docs', 'design', 'font-manifest.json'), fontManifestJson(), 'utf-8')
  await fs.writeFile(path.join(FIX, 'fonts-default.golden.txt'), generateFontsModule({}).source, 'utf-8')
  for (const name of ['editorial', 'noitalic']) {
    const design = JSON.parse(await fs.readFile(path.join(FIX, `design-${name}.json`), 'utf-8')) as {
      typography: Record<string, string>
    }
    await fs.writeFile(path.join(FIX, `fonts-${name}.golden.txt`), generateFontsModule(design.typography).source, 'utf-8')
  }
  console.log('✓ Wrote docs/design/font-manifest.json + font golden fixtures')
}

main().catch((err) => {
  console.error('Error writing design contracts:', err)
  process.exit(1)
})
```

- [ ] **Step 6: Add the npm scripts**

In `package.json` `"scripts"`, after `"export-kit"`, add:

```json
    "generate-fonts": "tsx scripts/generate-fonts.ts",
    "design-contracts": "tsx scripts/generate-design-contracts.ts",
```

- [ ] **Step 7: Generate the committed files**

Run: `npm run generate-fonts && npm run design-contracts`
Expected: both print `✓ …`. `src/app/fonts.generated.ts` equals the `DEFAULT_MODULE` text from Task 4's test.

- [ ] **Step 8: Switch `layout.tsx` to the generated module**

In `src/app/layout.tsx`:
- delete the `import { Public_Sans, Fraunces, Geist_Mono } from 'next/font/google'` line;
- delete the three `const publicSans/fraunces/geistMono = …` blocks and their comments;
- delete `import type { CSSProperties } from 'react'`;
- add, after `import './globals.css'`:

```ts
// Fonts come from a GENERATED next/font module (scripts/generate-fonts.ts,
// from design.json typography). The default file loads exactly the fonts this
// layout used to hardcode, so untouched sites render unchanged.
import { fontAliases, fontVariables } from './fonts.generated'
```

Then replace the `<html …>` opening attributes:

```tsx
      className={fontVariables}
```
(replacing `` className={`${publicSans.variable} ${fraunces.variable} ${geistMono.variable}`} ``)

```tsx
      style={fontAliases}
```
(replacing `style={{ '--font-body-loaded': 'var(--font-heading-loaded)' } as CSSProperties}`)

- [ ] **Step 9: Run the unit tests, types and lint**

Run: `npm test && npx tsc --noEmit && npm run lint && npx tsx scripts/generate-fonts.ts --check`
Expected: all green; `--check` prints `✓`.

- [ ] **Step 10: Verify R1 (build + e2e + pixel baseline)**

Run: `npm run build && npx playwright test e2e/design-defaults.spec.ts e2e/zero-change.spec.ts`
Expected: 10 passed, zero screenshot diffs. If `zero-change` diffs, the default module does not reproduce today's fonts: fix the generator. Do NOT update snapshots.

- [ ] **Step 11: Commit**

```bash
git add scripts/generate-fonts.ts scripts/generate-design-contracts.ts package.json src/app/fonts.generated.ts src/app/layout.tsx \
  src/lib/theme/fonts-generated.test.ts src/lib/theme/__fixtures__/fonts docs/design/font-manifest.json
git commit -m "feat(theme): live fonts via a generated next/font module

layout.tsx imports src/app/fonts.generated.ts (from design.json typography)
instead of hardcoding Public Sans / Fraunces / Geist Mono. The default file
reproduces those exactly (pixel baseline unchanged).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: [TEMPLATE] CI — fonts drift check + build every manifest font once (R4)

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `scripts/generate-fonts.ts --check / --all` (Task 5).

- [ ] **Step 1: Add the drift check to the `check` job**

In `.github/workflows/ci.yml`, insert after the `Type check` step:

```yaml
      - name: Fonts module matches design.json
        run: npx tsx scripts/generate-fonts.ts --check
```

- [ ] **Step 2: Add the parallel `fonts` job**

Append under `jobs:` (same indentation as `check:`):

```yaml
  fonts:
    name: Build every manifest font once
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install
        run: npm ci

      - name: Cache Next build
        uses: actions/cache@v4
        with:
          path: .next/cache
          key: next-fonts-${{ runner.os }}-${{ hashFiles('package-lock.json', 'src/lib/theme/font-manifest.ts') }}

      # Overwrites the committed module IN THE CI WORKSPACE ONLY with one
      # next/font call per manifest family (all weights, italic where shipped),
      # so this build proves every family a client can pick resolves.
      - name: Generate an all-fonts module
        run: npx tsx scripts/generate-fonts.ts --all

      - name: Build
        run: npm run build
```

- [ ] **Step 3: Reproduce the job locally**

Run: `npx tsx scripts/generate-fonts.ts --all && npm run build; git checkout -- src/app/fonts.generated.ts && npx tsx scripts/generate-fonts.ts --check`
Expected: the build succeeds (all 22 families download and resolve); `--check` is `✓` after the restore.

- [ ] **Step 4: Validate the YAML**

Run: `node -e "require('node:fs').readFileSync('.github/workflows/ci.yml','utf8')" && npx --yes js-yaml .github/workflows/ci.yml > /dev/null && echo ok`
Expected: `ok`. The workflow itself runs when the branch's PR to `main` is opened; confirm both jobs are green there.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(theme): fonts-module drift check + build every manifest font once

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: [TEMPLATE] Capability marker + `<meta name="c5-capabilities">` (T1 release)

**Files:**
- Create: `c5-template.json`
- Create: `src/lib/theme/template-marker.ts`
- Create: `src/lib/theme/template-marker.test.ts`
- Modify: `src/app/layout.tsx` (`generateMetadata`)
- Modify: `e2e/design-defaults.spec.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces:
  - `TEMPLATE_MARKER: { templateVersion: string; capabilities: string[] }`;
  - `KNOWN_CAPABILITIES = ['fonts', 'style-axes', 'specimen']`;
  - `capabilitiesMetaContent(): string` (comma-joined);
  - HTML `<meta name="c5-capabilities" content="fonts">` on every page (platform Task 16 parses it).

- [ ] **Step 1: Write the failing test**

Create `src/lib/theme/template-marker.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { KNOWN_CAPABILITIES, TEMPLATE_MARKER, capabilitiesMetaContent } from './template-marker'

describe('c5-template.json', () => {
  it('declares exactly the T1 capabilities (R2)', () => {
    expect(TEMPLATE_MARKER).toEqual({ templateVersion: '2026.09.1', capabilities: ['fonts'] })
  })
  it('only uses tokens the platform knows', () => {
    for (const c of TEMPLATE_MARKER.capabilities) expect(KNOWN_CAPABILITIES).toContain(c)
  })
  it('renders the meta content comma-joined', () => {
    expect(capabilitiesMetaContent()).toBe(TEMPLATE_MARKER.capabilities.join(','))
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/theme/template-marker.test.ts`
Expected: FAIL — cannot resolve `./template-marker`.

- [ ] **Step 3: Create the marker and its reader**

Create `c5-template.json` (repo root):

```json
{
  "templateVersion": "2026.09.1",
  "capabilities": ["fonts"]
}
```

Create `src/lib/theme/template-marker.ts`:

```ts
/**
 * The template's capability marker (repo-root c5-template.json). The Revaltus
 * Design Studio reads it from the DRAFT branch and intersects it with the
 * <meta name="c5-capabilities"> this layout emits on the DEPLOYED site, so a
 * lever unlocks only when both the next build and the live shell support it.
 * Tokens: fonts (L2), style-axes (L3), specimen (L4).
 */
import raw from '../../../c5-template.json'

export const KNOWN_CAPABILITIES = ['fonts', 'style-axes', 'specimen'] as const
export type TemplateMarker = { templateVersion: string; capabilities: string[] }

export const TEMPLATE_MARKER: TemplateMarker = {
  templateVersion: String(raw.templateVersion),
  capabilities: raw.capabilities.map(String),
}

export function capabilitiesMetaContent(marker: TemplateMarker = TEMPLATE_MARKER): string {
  return marker.capabilities.join(',')
}
```

- [ ] **Step 4: Emit the meta from the root layout**

In `src/app/layout.tsx`, add `import { capabilitiesMetaContent } from '@/lib/theme/template-marker'` after the `getDesignConfig` import. In `generateMetadata`'s returned object, after `description: …`, add:

```ts
    // Design Studio capability handshake (see src/lib/theme/template-marker.ts).
    // Pages don't set `other`, so every page inherits it.
    other: { 'c5-capabilities': capabilitiesMetaContent() },
```

- [ ] **Step 5: Extend the e2e defaults spec**

Append to `e2e/design-defaults.spec.ts`:

```ts
for (const path of ['/', '/privacy-policy']) {
  test(`${path} advertises the template capabilities`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator('meta[name="c5-capabilities"]')).toHaveAttribute('content', 'fonts')
  })
}
```

- [ ] **Step 6: Run everything**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run validate && npm run build && npm run test:e2e && npx playwright test e2e/zero-change.spec.ts`
Expected: all green; zero-change still has zero diffs. The meta tag doesn't render.

- [ ] **Step 7: Add the CHANGELOG entry**

Insert at the top of `CHANGELOG.md`, under the intro paragraph:

```markdown
## [2026.09.1] — Design Studio T1: live fonts + capability marker

### Added
- **Live fonts.** `src/app/fonts.generated.ts` (generated by `npm run generate-fonts`
  from `design.json` typography, incl. the new optional `accentFont`) replaces the
  hardcoded next/font calls in `layout.tsx`. The default file loads exactly the
  previous fonts. Allowed families: `src/lib/theme/font-manifest.ts`
  (mirrored at `docs/design/font-manifest.json`).
- **Capability marker** `c5-template.json` + `<meta name="c5-capabilities">` on every
  page, read by the Revaltus Design Studio.
- CI: fonts-module drift check, and a job that builds every manifest font once.

### Fixed
- `content/redirects.csv` destinations starting `//` or `/\` (open redirect) are skipped.

### Rollout notes
- `src/app/fonts.generated.ts` is client-owned after seeding: never overwrite it in a
  fleet sync; seed it (this default file, verbatim) only when absent. Write
  `c5-template.json` last.
```

- [ ] **Step 8: Commit**

```bash
git add c5-template.json src/lib/theme/template-marker.ts src/lib/theme/template-marker.test.ts src/app/layout.tsx e2e/design-defaults.spec.ts CHANGELOG.md
git commit -m "feat(theme): c5-template.json capability marker + c5-capabilities meta (T1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

# Track P6a — Platform: fonts at L2, shell intersection, fonts-module write path

> Start on `feat/design-studio-p6` off `master` once the audit branch has merged and template Task 7 is committed. The template repo path used for copying fixtures is `/Users/webhank/LocalSites/counting-five-client-template`.

### Task 15: [PLATFORM] Font manifest mirror + byte-parity fonts-module generator + goldens

**Files:**
- Create: `lib/content/font-manifest.ts`
- Create: `lib/content/font-module-generator.ts`
- Create: `lib/content/font-module-generator.test.ts`
- Create (copied): `lib/content/__fixtures__/font-manifest.template.json`, `fonts-default.golden.txt`, `fonts-editorial.golden.txt`, `fonts-noitalic.golden.txt`, `design-fonts-editorial.json`, `design-fonts-noitalic.json`

**Interfaces:**
- Produces:
  - `FONT_MANIFEST`, `FontManifestEntry`, `MONO_FAMILY`, `DEFAULT_TYPOGRAPHY`, `fontManifestJson()` (identical to the template's);
  - `generateFontsModule(t: { headingFont?: string; bodyFont?: string; accentFont?: string }): { source: string; warnings: string[] }`.
- Used by Tasks 17–18.

- [ ] **Step 1: Copy the template contracts as fixtures**

```bash
T=/Users/webhank/LocalSites/counting-five-client-template
F=lib/content/__fixtures__
cp $T/docs/design/font-manifest.json $F/font-manifest.template.json
cp $T/src/lib/theme/__fixtures__/fonts/fonts-default.golden.txt $F/fonts-default.golden.txt
cp $T/src/lib/theme/__fixtures__/fonts/fonts-editorial.golden.txt $F/fonts-editorial.golden.txt
cp $T/src/lib/theme/__fixtures__/fonts/fonts-noitalic.golden.txt $F/fonts-noitalic.golden.txt
cp $T/src/lib/theme/__fixtures__/fonts/design-editorial.json $F/design-fonts-editorial.json
cp $T/src/lib/theme/__fixtures__/fonts/design-noitalic.json $F/design-fonts-noitalic.json
```

- [ ] **Step 2: Write the failing parity test**

Create `lib/content/font-module-generator.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURATED_FONTS } from './type-pairing-catalog'
import { FONT_MANIFEST, fontManifestJson } from './font-manifest'
import { generateFontsModule } from './font-module-generator'

// Goldens are the ACTUAL output of the template's scripts/generate-fonts.ts
// (counting-five-client-template src/lib/theme/__fixtures__/fonts/), copied
// verbatim — the same drift guard as theme.css.golden. If the template
// generator changes, re-copy and port together.
const FIX = path.join(__dirname, '__fixtures__')
const read = (f: string) => readFileSync(path.join(FIX, f), 'utf-8')

describe('font manifest parity', () => {
  it('matches the template docs/design/font-manifest.json byte for byte', () => {
    expect(fontManifestJson()).toBe(read('font-manifest.template.json'))
  })
  it('covers every curated font (the only fonts the platform writes)', () => {
    const families = FONT_MANIFEST.map((e) => e.family)
    for (const f of CURATED_FONTS) expect(families).toContain(f)
  })
})

describe('generateFontsModule (byte parity with the template)', () => {
  it('default typography → the template default module', () => {
    expect(generateFontsModule({ headingFont: 'Public Sans', bodyFont: 'Public Sans', accentFont: 'Fraunces' }).source).toBe(
      read('fonts-default.golden.txt'),
    )
  })
  it.each(['editorial', 'noitalic'])('%s fixture → its golden', (name) => {
    const design = JSON.parse(read(`design-fonts-${name}.json`)) as { typography: Record<string, string> }
    expect(generateFontsModule(design.typography).source).toBe(read(`fonts-${name}.golden.txt`))
  })
  it('never warns for a curated font', () => {
    for (const f of CURATED_FONTS) expect(generateFontsModule({ headingFont: f, bodyFont: f, accentFont: f }).warnings).toEqual([])
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run lib/content/font-module-generator.test.ts`
Expected: FAIL — cannot resolve `./font-manifest`.

- [ ] **Step 4: Port the manifest**

Create `lib/content/font-manifest.ts`. Copy the template's `src/lib/theme/font-manifest.ts` (Task 3 Step 3) VERBATIM below this header:

```ts
// Byte-parity port of the client template's src/lib/theme/font-manifest.ts
// (counting-five-client-template). Parity is tested against the template's
// docs/design/font-manifest.json (__fixtures__/font-manifest.template.json).
// Pure + client-safe.
```

- [ ] **Step 5: Port the generator**

Create `lib/content/font-module-generator.ts`. Copy the template's `src/lib/theme/font-module.ts` (Task 4 Step 3) VERBATIM, with only these changes:
- the import line becomes `import { DEFAULT_TYPOGRAPHY, FONT_MANIFEST, MONO_FAMILY, type FontManifestEntry } from './font-manifest'`;
- the header comment becomes:

```ts
// Regenerate a client site's src/app/fonts.generated.ts from design.json
// typography — a PURE, byte-for-byte port of the template's
// src/lib/theme/font-module.ts (counting-five-client-template). The platform
// owns this because the template does not regenerate the module on deploy:
// it is a committed file, so a font change must ship the regenerated module
// alongside design.json. The golden-fixture test guards drift. Pure +
// client-safe. `generateAllFontsModule` is template-CI-only and NOT ported.
```

Delete `generateAllFontsModule` from the port.

- [ ] **Step 6: Run the tests and types**

Run: `npx vitest run lib/content/font-module-generator.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add lib/content/font-manifest.ts lib/content/font-module-generator.ts lib/content/font-module-generator.test.ts \
  lib/content/__fixtures__/font-manifest.template.json lib/content/__fixtures__/fonts-default.golden.txt \
  lib/content/__fixtures__/fonts-editorial.golden.txt lib/content/__fixtures__/fonts-noitalic.golden.txt \
  lib/content/__fixtures__/design-fonts-editorial.json lib/content/__fixtures__/design-fonts-noitalic.json
git commit -m "feat(design-studio): byte-parity fonts-module generator + manifest (P6a)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: [PLATFORM] Capabilities = draft marker ∩ deployed shell meta

**Files:**
- Create: `lib/design/shell-capabilities.ts`
- Create: `lib/design/shell-capabilities.test.ts`
- Modify: `lib/design/capabilities.ts`, `lib/design/capabilities.test.ts`
- Modify: `lib/design/run-types.ts` (`DesignCapabilities`)
- Modify: `lib/design/capabilities-read.ts`, `lib/design/capabilities-read.test.ts`
- Modify: `app/api/edit/[id]/design/runs/route.ts`, `lib/design/chat-turn.ts`, `lib/design/commit-version.ts` (capability read only — the fonts write lands in Task 18)
- Modify the mocks in `lib/design/commit-version.test.ts`, `lib/design/chat-turn.test.ts`, and the runs route test if it mocks `readDesignCapabilities`

**Interfaces:**
- Produces:
  - `parseShellCapabilities(html: string): string[]`;
  - `type ShellCapabilities = { status: 'verified'; capabilities: string[] } | { status: 'unverified' }`;
  - `readShellCapabilities(args: { jobId: string; githubRepo: string }, now?: number): Promise<ShellCapabilities>`;
  - `__resetShellCapabilitiesCacheForTests()`;
  - `capabilityLevel(caps: string[]): CapabilityLevel`;
  - `intersectWithShell(draft: DesignCapabilities, shell: ShellCapabilities): DesignCapabilities`;
  - `specimenUnlocked(c): boolean`;
  - `DesignCapabilities.shell?: 'verified' | 'unverified'`;
  - `type CapabilityRead = { draft: DesignCapabilities; effective: DesignCapabilities }`;
  - `readEffectiveCapabilities(args: { githubRepo: string; jobId: string }): Promise<CapabilityRead>`.

- [ ] **Step 1: Write the failing tests**

Create `lib/design/shell-capabilities.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ siteUrl: vi.fn(), get: vi.fn() }))
vi.mock('@/lib/theme-preview/site-url', () => ({ getPreviewSiteUrl: (a: unknown) => m.siteUrl(a) }))
vi.mock('@/lib/audit/crawl', () => ({ safeGet: (u: string) => m.get(u) }))

import { __resetShellCapabilitiesCacheForTests, parseShellCapabilities, readShellCapabilities } from './shell-capabilities'

const page = (meta: string) => ({ status: 200, contentType: 'text/html', finalUrl: 'https://a.test/', body: `<html><head>${meta}</head></html>` })

describe('parseShellCapabilities', () => {
  it.each([
    ['<meta name="c5-capabilities" content="fonts"/>', ['fonts']],
    ['<meta content="fonts,style-axes,specimen" name="c5-capabilities">', ['fonts', 'style-axes', 'specimen']],
    ["<meta name='C5-Capabilities' content=' Fonts , fonts '>", ['fonts']],
    ['<meta name="c5-capabilities" content="fonts,<script>,x y">', ['fonts', 'x', 'y']],
    ['<meta name="description" content="fonts">', []],
    ['', []],
  ])('%s → %j', (meta, caps) => {
    expect(parseShellCapabilities(`<html><head>${meta}</head></html>`)).toEqual(caps)
  })
})

describe('readShellCapabilities', () => {
  beforeEach(() => {
    __resetShellCapabilitiesCacheForTests()
    m.siteUrl.mockReset().mockResolvedValue('https://a.test')
    m.get.mockReset()
  })
  it('verifies from the live homepage and caches for 60s', async () => {
    m.get.mockResolvedValue(page('<meta name="c5-capabilities" content="fonts">'))
    const args = { jobId: 'j', githubRepo: 'o/r' }
    expect(await readShellCapabilities(args, 1000)).toEqual({ status: 'verified', capabilities: ['fonts'] })
    await readShellCapabilities(args, 50_000)
    expect(m.get).toHaveBeenCalledTimes(1)
    await readShellCapabilities(args, 62_000)
    expect(m.get).toHaveBeenCalledTimes(2)
  })
  it('a reachable shell without the meta verifies as no capabilities', async () => {
    m.get.mockResolvedValue(page(''))
    expect(await readShellCapabilities({ jobId: 'j', githubRepo: 'o/r' })).toEqual({ status: 'verified', capabilities: [] })
  })
  it.each([
    ['no preview url', () => m.siteUrl.mockResolvedValue(null)],
    ['blocked fetch', () => m.get.mockResolvedValue(null)],
    ['http 503', () => m.get.mockResolvedValue({ ...page(''), status: 503 })],
    ['non-html', () => m.get.mockResolvedValue({ ...page(''), contentType: 'application/json' })],
    ['throws', () => m.get.mockRejectedValue(new Error('boom'))],
  ])('is unverified (and uncached) on %s', async (_n, arrange) => {
    arrange()
    expect(await readShellCapabilities({ jobId: 'j', githubRepo: 'o/r' })).toEqual({ status: 'unverified' })
  })
})
```

Append to `lib/design/capabilities.test.ts` (add `intersectWithShell`, `capabilityLevel`, `specimenUnlocked` to the import from `./capabilities`):

```ts
describe('intersectWithShell', () => {
  const L4 = parseTemplateMarker(JSON.stringify({ templateVersion: '2026.09.2', capabilities: ['fonts', 'style-axes', 'specimen'] }))
  it('keeps only what the deployed shell also declares', () => {
    const c = intersectWithShell(L4, { status: 'verified', capabilities: ['fonts'] })
    expect(c).toMatchObject({ level: 2, capabilities: ['fonts'], shell: 'verified', source: 'marker', templateVersion: '2026.09.2' })
  })
  it('a shell with no meta drops the site to L1', () => {
    expect(intersectWithShell(L4, { status: 'verified', capabilities: [] }).level).toBe(1)
  })
  it('never raises the draft tier', () => {
    expect(intersectWithShell(L2, { status: 'verified', capabilities: ['fonts', 'style-axes', 'specimen'] }).level).toBe(2)
  })
  it('an unverified shell keeps the draft tier (flagged)', () => {
    expect(intersectWithShell(L4, { status: 'unverified' })).toEqual({ ...L4, shell: 'unverified' })
  })
  it('round-trips through capabilitiesFromJson', () => {
    const c = intersectWithShell(L4, { status: 'verified', capabilities: ['fonts', 'style-axes'] })
    expect(capabilitiesFromJson(JSON.parse(JSON.stringify(c)))).toEqual(c)
  })
  it('exposes the tier helpers', () => {
    expect(capabilityLevel(['fonts', 'style-axes', 'specimen'])).toBe(4)
    expect(specimenUnlocked(L4)).toBe(true)
    expect(specimenUnlocked(L2)).toBe(false)
  })
})
```

Append to `lib/design/capabilities-read.test.ts`. The file already mocks `@/lib/github/repo-files`; add a mock for `./shell-capabilities` at the top with the other mocks:

```ts
const shell = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('./shell-capabilities', () => ({ readShellCapabilities: (a: unknown) => shell.read(a) }))
```

and the cases (import `readEffectiveCapabilities`). Stub the draft marker read with this file's existing `repo-files` mock so the draft marker is `{"templateVersion":"2026.09.2","capabilities":["fonts","style-axes","specimen"]}`:

```ts
describe('readEffectiveCapabilities', () => {
  it('returns the draft marker and its intersection with the shell', async () => {
    shell.read.mockResolvedValue({ status: 'verified', capabilities: ['fonts'] })
    const r = await readEffectiveCapabilities({ githubRepo: 'o/r', jobId: 'j' })
    expect(r.draft.level).toBe(4)
    expect(r.effective).toMatchObject({ level: 2, capabilities: ['fonts'], shell: 'verified' })
    expect(shell.read).toHaveBeenCalledWith({ githubRepo: 'o/r', jobId: 'j' })
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run lib/design/shell-capabilities.test.ts lib/design/capabilities.test.ts lib/design/capabilities-read.test.ts`
Expected: FAIL — missing module / missing exports.

- [ ] **Step 3: Implement `shell-capabilities.ts`**

```ts
// Server-only (safeGet). The DEPLOYED shell's half of the capability
// handshake: the template's root layout emits
// <meta name="c5-capabilities" content="fonts,style-axes,specimen"> (T1+).
// Absent meta on a reachable page = a template that predates T1 → []. An
// unreachable page is 'unverified' (callers keep the draft tier — see
// intersectWithShell). Verified reads are cached per site URL for 60 s;
// failures are never cached.
import { safeGet } from '@/lib/audit/crawl'
import { getPreviewSiteUrl } from '@/lib/theme-preview/site-url'

export const SHELL_CAPABILITIES_META = 'c5-capabilities'
export type ShellCapabilities = { status: 'verified'; capabilities: string[] } | { status: 'unverified' }

const TOKEN_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const MAX_TOKENS = 20
const MAX_SCAN = 200_000
const TTL_MS = 60_000
const CACHE_MAX = 200
const cache = new Map<string, { at: number; value: ShellCapabilities }>()

export function __resetShellCapabilitiesCacheForTests(): void {
  cache.clear()
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)
  return m ? m[2] : null
}

export function parseShellCapabilities(html: string): string[] {
  for (const match of html.slice(0, MAX_SCAN).matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0]
    if (attr(tag, 'name')?.trim().toLowerCase() !== SHELL_CAPABILITIES_META) continue
    const tokens = (attr(tag, 'content') ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => TOKEN_RE.test(s))
    return [...new Set(tokens)].slice(0, MAX_TOKENS)
  }
  return []
}

export async function readShellCapabilities(args: { jobId: string; githubRepo: string }, now: number = Date.now()): Promise<ShellCapabilities> {
  let siteUrl: string | null
  try {
    siteUrl = await getPreviewSiteUrl(args)
  } catch {
    return { status: 'unverified' }
  }
  if (!siteUrl) return { status: 'unverified' }
  const hit = cache.get(siteUrl)
  if (hit && now - hit.at < TTL_MS) return hit.value

  const res = await safeGet(siteUrl).catch(() => null)
  const html = res && res.status >= 200 && res.status < 400 && (!res.contentType || res.contentType.toLowerCase().includes('html'))
  if (!res || !html) return { status: 'unverified' }
  const value: ShellCapabilities = { status: 'verified', capabilities: parseShellCapabilities(res.body) }
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(siteUrl, { at: now, value })
  return value
}
```

- [ ] **Step 4: Extend `run-types.ts` and `capabilities.ts`**

In `lib/design/run-types.ts`, add a field to `DesignCapabilities`:

```ts
  // How the tier was checked against the DEPLOYED shell's c5-capabilities
  // meta: 'verified' = intersected; 'unverified' = shell unreachable, draft
  // tier kept. Absent on draft-only reads and pre-P6a run snapshots.
  shell?: 'verified' | 'unverified'
```

In `lib/design/capabilities.ts`:
- update the header comment's intersection sentence to: `Effective tier = draft marker ∩ the deployed shell's <meta name="c5-capabilities"> (intersectWithShell, P6a).`
- rename `levelFor` to exported `capabilityLevel` (update its two call sites);
- import `ShellCapabilities` as a type from `./shell-capabilities`;
- add:

```ts
export const specimenUnlocked = (c: DesignCapabilities): boolean => c.level >= 4

// Effective tier: a lever unlocks only when the DRAFT template (what the next
// build ships) AND the DEPLOYED shell (what previews render on) both declare
// it. An unreachable shell keeps the draft tier, flagged 'unverified' —
// previews need the shell anyway, and the font preview uses Google Fonts.
export function intersectWithShell(draft: DesignCapabilities, shell: ShellCapabilities): DesignCapabilities {
  if (shell.status === 'unverified') return { ...draft, shell: 'unverified' }
  const capabilities = draft.capabilities.filter((c) => shell.capabilities.includes(c))
  return { ...draft, capabilities, level: capabilityLevel(capabilities), shell: 'verified' }
}
```

In `capabilitiesFromJson`, keep a valid `shell`: destructure `shell` from `value`, and add to the returned object `...(shell === 'verified' || shell === 'unverified' ? { shell } : {})`.

- [ ] **Step 5: Add `readEffectiveCapabilities`**

Append to `lib/design/capabilities-read.ts`, and update the header comment to mention it:

```ts
import { intersectWithShell } from './capabilities'
import { readShellCapabilities } from './shell-capabilities'

// `draft`: what the draft template supports — use for FILE-CONTRACT decisions
// (write/guard the fonts module, which paths applied_blobs + drift track).
// `effective`: draft ∩ deployed shell — use for GATES (which levers a run,
// chat or commit may change).
export type CapabilityRead = { draft: DesignCapabilities; effective: DesignCapabilities }

export async function readEffectiveCapabilities(args: { githubRepo: string; jobId: string }): Promise<CapabilityRead> {
  const [draft, shell] = await Promise.all([readDesignCapabilities(args.githubRepo), readShellCapabilities(args)])
  return { draft, effective: intersectWithShell(draft, shell) }
}
```

(Merge the new imports into the file's existing import block.)

- [ ] **Step 6: Switch the three gate call sites to the effective tier**

- `app/api/edit/[id]/design/runs/route.ts`: replace the `readDesignCapabilities` import with `readEffectiveCapabilities`. Replace the read with `const capabilities = (await readEffectiveCapabilities({ githubRepo: ctx.githubRepo, jobId: ctx.jobId })).effective`.
- `lib/design/chat-turn.ts`: import `readEffectiveCapabilities`. In the `Promise.all`, replace `readDesignCapabilities(actor.githubRepo)` with `readEffectiveCapabilities({ githubRepo: actor.githubRepo, jobId: actor.jobId })`, and rename the destructured `caps` to `capRead`. Directly after the `Promise.all`, add `const caps = capRead.effective` so every later use of `caps` is unchanged. (Task 18 also uses `capRead.draft` for drift.)
- `lib/design/commit-version.ts`: import `readEffectiveCapabilities`. Replace the violations line with:

```ts
  const capRead = await readEffectiveCapabilities({ githubRepo: target.githubRepo, jobId: target.jobId })
  const violations = capabilityViolations(bundle, current.bundle, capRead.effective)
```

Update the three test files' `./capabilities-read` mocks to export `readEffectiveCapabilities: (a: unknown) => m.effective(a)`. Default it in each `beforeEach` to `m.effective.mockResolvedValue({ draft: DEFAULT_CAPABILITIES, effective: DEFAULT_CAPABILITIES })`. Where a test set `m.caps.mockResolvedValue(X)`, set `m.effective.mockResolvedValue({ draft: X, effective: X })` instead. Keep the assertions unchanged.

- [ ] **Step 7: Run the tests, types and lint**

Run: `npx vitest run lib/design && npx vitest run app/api/edit && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add lib/design/shell-capabilities.ts lib/design/shell-capabilities.test.ts lib/design/capabilities.ts lib/design/capabilities.test.ts \
  lib/design/run-types.ts lib/design/capabilities-read.ts lib/design/capabilities-read.test.ts lib/design/chat-turn.ts lib/design/chat-turn.test.ts \
  lib/design/commit-version.ts lib/design/commit-version.test.ts "app/api/edit/[id]/design/runs"
git commit -m "feat(design-studio): capabilities = draft marker ∩ deployed shell meta (P6a)

Resolves the P3 deviation 'capabilities come from the draft marker only':
the template now emits <meta name=\"c5-capabilities\">.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: [PLATFORM] Fonts-module file contract — paths, drift compat, snapshot, bundle-files

**Files:**
- Modify: `lib/design/drift.ts`, `lib/design/drift.test.ts`
- Modify: `lib/design/theme-snapshot.ts`, `lib/design/theme-snapshot.test.ts`
- Modify: `lib/design/bundle-files.ts`, `lib/design/bundle-files.test.ts`

**Interfaces:**
- Consumes: `generateFontsModule` (Task 15); `fontsUnlocked` (existing).
- Produces:
  - `FONTS_MODULE_PATH = 'src/app/fonts.generated.ts'`;
  - `SNAPSHOT_PATHS` = the four theme paths + the fonts module;
  - `type SnapshotPath`;
  - `themeFilePaths(draftCaps: DesignCapabilities): readonly SnapshotPath[]`;
  - `computeDrift(current, latest, paths?: readonly string[])`;
  - `mergeAppliedBlobs(shas, written, paths?: readonly string[])`;
  - `isFontsModuleStale(texts): boolean | null`;
  - `DraftThemeSnapshot.texts: Partial<Record<SnapshotPath, string>>`;
  - `bundleToRepoFiles(bundle, current, opts: { removeLegacy: boolean; fontsModule?: boolean })`, with `RenderedThemeFiles.fontsModule?: string`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/design/drift.test.ts` (add the new names to the `./drift` import; import `generateFontsModule` from `@/lib/content/font-module-generator` and `parseTemplateMarker` from `./capabilities`):

```ts
const SHA = (c: string) => c.repeat(40)
const L1 = parseTemplateMarker(null)
const L2 = parseTemplateMarker(JSON.stringify({ templateVersion: '2026.09.1', capabilities: ['fonts'] }))
const FOUR = { 'content/brand.json': SHA('a'), 'content/design.json': SHA('b'), 'src/styles/theme.css': SHA('c'), 'content/design-overrides.css': SHA('d') }

describe('fonts module file contract', () => {
  it('tracks the fonts module only on L2+ drafts', () => {
    expect(themeFilePaths(L1)).toEqual(THEME_FILE_PATHS)
    expect(themeFilePaths(L2)).toEqual([...THEME_FILE_PATHS, FONTS_MODULE_PATH])
  })
  it('mergeAppliedBlobs includes the fonts sha only when asked for its path', () => {
    const shas = { ...FOUR, [FONTS_MODULE_PATH]: SHA('e') }
    expect(mergeAppliedBlobs(shas, {})).toEqual(FOUR)
    expect(mergeAppliedBlobs(shas, { [FONTS_MODULE_PATH]: SHA('f') }, themeFilePaths(L2))).toEqual({ ...FOUR, [FONTS_MODULE_PATH]: SHA('f') })
  })
  it('a pre-P6a version (no fonts sha) is not drifted by the fonts module', () => {
    const current = { ...FOUR, [FONTS_MODULE_PATH]: SHA('e') }
    expect(computeDrift(current, { versionNo: 3, appliedBlobs: FOUR }, themeFilePaths(L2)).status).toBe('in-sync')
  })
  it('a version that recorded the fonts sha detects a changed module', () => {
    const current = { ...FOUR, [FONTS_MODULE_PATH]: SHA('f') }
    const latest = { versionNo: 4, appliedBlobs: { ...FOUR, [FONTS_MODULE_PATH]: SHA('e') } }
    expect(computeDrift(current, latest, themeFilePaths(L2))).toEqual({ status: 'drifted', changedPaths: [FONTS_MODULE_PATH], sinceVersion: 4 })
  })
  it('isFontsModuleStale compares the module to design.json typography', () => {
    const design = JSON.stringify({ typography: { headingFont: 'Inter', bodyFont: 'Inter', accentFont: 'Fraunces' } })
    const fresh = generateFontsModule({ headingFont: 'Inter', bodyFont: 'Inter', accentFont: 'Fraunces' }).source
    expect(isFontsModuleStale({ 'content/design.json': design, [FONTS_MODULE_PATH]: fresh })).toBe(false)
    expect(isFontsModuleStale({ 'content/design.json': design, [FONTS_MODULE_PATH]: 'old' })).toBe(true)
    expect(isFontsModuleStale({ 'content/design.json': design })).toBeNull()
    expect(isFontsModuleStale({ 'content/design.json': '{bad', [FONTS_MODULE_PATH]: fresh })).toBeNull()
  })
})
```

Append to `lib/design/theme-snapshot.test.ts` a case that follows the file's existing `listTree` / `readTextBlobs` mocks. It returns a tree containing `src/app/fonts.generated.ts` (plus an unrelated `src/app/page.tsx`) and asserts:
- `snapshot.shas['src/app/fonts.generated.ts']` is set;
- `snapshot.texts['src/app/fonts.generated.ts']` equals the mocked blob text;
- `'src/app/page.tsx'` is absent from `shas`.

Append to `lib/design/bundle-files.test.ts` (the file already builds a bundle from its fixture; reuse its `current` repo files):

```ts
describe('fonts module (L2+ drafts)', () => {
  it('derives the fonts module from the bundle typography only when asked', () => {
    const b = { ...VALID, typography: { headingFont: 'Inter', bodyFont: 'Inter', accentFont: 'Fraunces' } }
    const off = bundleToRepoFiles(b, CURRENT, { removeLegacy: true })
    expect(off.ok && off.files.fontsModule).toBeUndefined()
    const on = bundleToRepoFiles(b, CURRENT, { removeLegacy: true, fontsModule: true })
    expect(on.ok && on.files.fontsModule).toBe(generateFontsModule({ headingFont: 'Inter', bodyFont: 'Inter', accentFont: 'Fraunces' }).source)
  })
})
```

(`VALID` / `CURRENT` = the names this test file already uses for its fixture bundle and repo files. If they differ, use the existing ones.)

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run lib/design/drift.test.ts lib/design/theme-snapshot.test.ts lib/design/bundle-files.test.ts`
Expected: FAIL — missing exports / `fontsModule` undefined.

- [ ] **Step 3: Implement the drift / path contract**

In `lib/design/drift.ts`:
- update the header to mention the fonts module;
- add `import type { DesignCapabilities } from './run-types'`, `import { fontsUnlocked } from './capabilities'`, `import { generateFontsModule } from '@/lib/content/font-module-generator'` and `import { normalizeTypography } from '@/app/api/edit/[id]/theme/_theme'`;
- then:

```ts
export const THEME_FILE_PATHS = [BRAND_PATH, DESIGN_PATH, THEME_CSS_PATH, OVERRIDES_PATH] as const
export type ThemeFilePath = (typeof THEME_FILE_PATHS)[number]

// The generated next/font module (template T1). Part of the theme ONLY on
// drafts whose template marker declares `fonts` (L2+): applied_blobs and drift
// then track five files. Callers pass themeFilePaths(draftCaps).
export const FONTS_MODULE_PATH = 'src/app/fonts.generated.ts'
export const SNAPSHOT_PATHS = [...THEME_FILE_PATHS, FONTS_MODULE_PATH] as const
export type SnapshotPath = (typeof SNAPSHOT_PATHS)[number]

export function themeFilePaths(draftCaps: DesignCapabilities): readonly SnapshotPath[] {
  return fontsUnlocked(draftCaps) ? SNAPSHOT_PATHS : THEME_FILE_PATHS
}
```

Replace `computeDrift` and `mergeAppliedBlobs`:

```ts
export function computeDrift(
  current: ThemeBlobShas,
  latest: { versionNo: number; appliedBlobs: ThemeBlobShas } | null,
  paths: readonly string[] = THEME_FILE_PATHS
): DriftResult {
  if (!latest) return { status: 'no-baseline', changedPaths: [], sinceVersion: null }
  // Compat: versions recorded before P6a (or on an L1 draft) have no fonts
  // sha — the fonts module is compared only once a version recorded it.
  const compared = paths.filter((p) => p !== FONTS_MODULE_PATH || latest.appliedBlobs[p] !== undefined)
  const changedPaths = compared.filter((p) => (current[p] ?? null) !== (latest.appliedBlobs[p] ?? null))
  return { status: changedPaths.length ? 'drifted' : 'in-sync', changedPaths, sinceVersion: latest.versionNo }
}

// The FULL post-apply blob map (the applied_blobs contract): the four theme
// files, plus the fonts module when `paths` includes it (L2+ drafts).
export function mergeAppliedBlobs(shas: ThemeBlobShas, written: Record<string, string>, paths: readonly string[] = THEME_FILE_PATHS): ThemeBlobShas {
  const out: ThemeBlobShas = {}
  for (const p of paths) {
    const sha = written[p] ?? shas[p]
    if (sha) out[p] = sha
  }
  return out
}

// true = the committed fonts module no longer matches design.json typography
// (e.g. a fleet-seeded default module on a site whose design.json names other
// fonts); null = no module on the draft, or design.json unreadable.
export function isFontsModuleStale(texts: Partial<Record<SnapshotPath, string>>): boolean | null {
  const moduleText = texts[FONTS_MODULE_PATH]
  const designText = texts[DESIGN_PATH]
  if (moduleText === undefined || !designText) return null
  try {
    const design = JSON.parse(designText) as Partial<DesignJson>
    return generateFontsModule(normalizeTypography(design.typography)).source !== moduleText
  } catch {
    return null
  }
}
```

Change `isThemeCssStale`'s parameter type to `Partial<Record<SnapshotPath, string>>`.

- [ ] **Step 4: Read the fonts module in the snapshot**

In `lib/design/theme-snapshot.ts`:
- replace `THEME_FILE_PATHS` / `ThemeFilePath` imports and uses with `SNAPSHOT_PATHS` / `SnapshotPath`. That covers the `wanted` set, the `readThemeSnapshotAt` iteration and the `texts` loop;
- change `DraftThemeSnapshot` to `{ shas: ThemeBlobShas; texts: Partial<Record<SnapshotPath, string>> }`;
- update the header comment: "the four theme files plus the generated fonts module (present on T1+ templates)".

`themeTextsFromSnapshot` is unchanged. `lib/design/chat-preview.ts` keeps `THEME_FILE_PATHS` in its cache key: previews don't read the module.

- [ ] **Step 5: Derive the module in `bundleToRepoFiles`**

In `lib/design/bundle-files.ts`:
- add `import { generateFontsModule } from '@/lib/content/font-module-generator'`;
- change `RenderedThemeFiles` to `{ brandText: string; designText: string; themeCss: string; overridesCss: string; fontsModule?: string }`;
- change the `opts` type to `{ removeLegacy: boolean; fontsModule?: boolean }`;
- in the success return, add to `files`:

```ts
      // L2+ drafts only (caller decides from the DRAFT marker): the generated
      // next/font module, always derived — never hand-edited.
      ...(opts.fontsModule ? { fontsModule: generateFontsModule(flagged.design.typography).source } : {}),
```

- [ ] **Step 6: Run the tests and types**

Run: `npx vitest run lib/design && npx tsc --noEmit`
Expected: all green. Every existing caller compiles unchanged, because every new parameter is optional.

- [ ] **Step 7: Commit**

```bash
git add lib/design/drift.ts lib/design/drift.test.ts lib/design/theme-snapshot.ts lib/design/theme-snapshot.test.ts lib/design/bundle-files.ts lib/design/bundle-files.test.ts
git commit -m "feat(design-studio): fonts module joins the theme file contract on L2+ drafts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: [PLATFORM] Write path — apply, commit, Controls, drift/state/import (fonts unlocked at L2)

**Files:**
- Modify: `lib/design/apply-bundle.ts`, `lib/design/apply-bundle.test.ts`
- Modify: `lib/design/commit-version.ts`, `lib/design/commit-version.test.ts`
- Modify: `lib/design/chat-turn.ts` (drift paths)
- Modify: `app/api/edit/[id]/design/route.ts`, `app/api/edit/[id]/design/versions/import/route.ts` (+ their tests)
- Modify: `app/api/edit/[id]/theme/route.ts`, `app/api/edit/[id]/theme/route.test.ts`
- Modify: `lib/design/studio-types.ts`, `components/design-studio/DesignStudio.tsx`, `components/design-studio/VersionsPanel.tsx`

**Interfaces:**
- Consumes: `FONTS_MODULE_PATH`, `themeFilePaths`, `mergeAppliedBlobs(…, paths)`, `computeDrift(…, paths)`, `isFontsModuleStale` (Task 17); `readEffectiveCapabilities` (Task 16); `generateFontsModule` (Task 15).
- Produces:
  - `applyBundleToDraft({ …, fontsModule?: boolean })` writes and sha-guards `src/app/fonts.generated.ts`;
  - `DesignStudioState.fontsModuleStale: boolean | null`.
- **The four-file contract change:** `applied_blobs` = the four theme files, plus `src/app/fonts.generated.ts` when the DRAFT marker declares `fonts`.

- [ ] **Step 1: Write the failing tests**

In `lib/design/apply-bundle.test.ts`, following its existing `readFile` / `writeFiles` mocks, add:

```ts
describe('fonts module (L2+ drafts)', () => {
  it('writes the regenerated module with its sha guard when fontsModule is set', async () => {
    // arrange: draft has brand/design/theme/overrides + src/app/fonts.generated.ts (sha 'e'*40, text 'old')
    const r = await applyBundleToDraft({ ...ARGS, bundle: interBundle, fontsModule: true })
    expect(r.ok && r.changedPaths).toContain('src/app/fonts.generated.ts')
    const written = m.writeFiles.mock.calls[0][1] as { path: string; content: string; expectedSha: unknown }[]
    const fonts = written.find((w) => w.path === 'src/app/fonts.generated.ts')
    expect(fonts).toEqual({
      path: 'src/app/fonts.generated.ts',
      content: generateFontsModule({ headingFont: 'Inter', bodyFont: 'Inter', accentFont: 'Fraunces' }).source,
      expectedSha: 'e'.repeat(40),
    })
  })
  it('never touches the module on an L1 draft', async () => {
    await applyBundleToDraft({ ...ARGS, bundle: interBundle })
    const written = m.writeFiles.mock.calls[0][1] as { path: string }[]
    expect(written.map((w) => w.path)).not.toContain('src/app/fonts.generated.ts')
  })
  it('base mode guards an unchanged module as a same-blob entry', async () => {
    // arrange a base snapshot whose fonts text already equals the regenerated module
    const r = await applyBundleToDraft({ ...ARGS, bundle: interBundle, fontsModule: true, base: BASE_WITH_FRESH_FONTS })
    const written = m.writeFiles.mock.calls[0][1] as { path: string; expectedSha: unknown }[]
    expect(written.find((w) => w.path === 'src/app/fonts.generated.ts')?.expectedSha).toBe('e'.repeat(40))
    expect(r.ok && r.changedPaths).not.toContain('src/app/fonts.generated.ts')
  })
})
```

(`ARGS`, `interBundle`, `BASE_WITH_FRESH_FONTS` are local fixtures built from the file's existing ones. `interBundle` = the fixture bundle with `typography: { headingFont: 'Inter', bodyFont: 'Inter', accentFont: 'Fraunces' }`.)

In `lib/design/commit-version.test.ts`, add:
- **"fonts unlocked at L2 (draft ∩ shell)":** with `m.effective` resolving `{ draft: L2, effective: L2 }` and a bundle that changes fonts, `commitDesignVersion` calls `m.apply` with `fontsModule: true`. The inserted version's `appliedBlobs` includes `src/app/fonts.generated.ts` when `m.apply` returns a blob for it.
- **"fonts locked when the live shell is L1":** with `{ draft: L2, effective: L1 }` and a font change → `{ ok: false, status: 422 }`, and `m.apply` is not called.
- **"L1 draft records four files":** with `{ draft: L1, effective: L1 }` and no font change, `m.apply` gets `fontsModule: false`, and `appliedBlobs` has no fonts key even if the snapshot has one.

In `app/api/edit/[id]/theme/route.test.ts`, add:
- **"Controls writes the fonts module on an L2 draft":** mock `readFile` for `c5-template.json` → `{"capabilities":["fonts"]}` and for `src/app/fonts.generated.ts` → `{ content: 'old', sha: 'e'*40 }`. PATCH `typography: { headingFont: 'Inter' }`. `writeFiles` receives `{ path: 'src/app/fonts.generated.ts', content: generateFontsModule(normalizeTypography(<patched design>.typography)).source, expectedSha: 'e'*40 }`.
- **"…and not on an L1 draft":** with no marker, no fonts path is written.

In the design state route test (`app/api/edit/[id]/design/route.test.ts`), add: `fontsModuleStale` is `true` when the snapshot has a module that doesn't match design.json on an L2 draft, and `null` on an L1 draft.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run lib/design/apply-bundle.test.ts lib/design/commit-version.test.ts "app/api/edit/[id]/theme" "app/api/edit/[id]/design/route.test.ts"`
Expected: FAIL.

- [ ] **Step 3: `applyBundleToDraft` writes and guards the module**

In `lib/design/apply-bundle.ts`:
- import `FONTS_MODULE_PATH` from `./drift`;
- add `fontsModule?: boolean` to the args type, with the comment `// L2+ DRAFT (marker declares fonts): also write/guard src/app/fonts.generated.ts`;
- destructure `fontsModule = false`;
- after `const overridesFile = await read(OVERRIDES_PATH)`, add:

```ts
  const fontsFile = fontsModule ? await read(FONTS_MODULE_PATH) : null
```

- pass `fontsModule` into `bundleToRepoFiles`'s opts: `{ removeLegacy: …, fontsModule }`;
- append to `candidates`:

```ts
    ...(fontsModule && rendered.files.fontsModule !== undefined
      ? [{ path: FONTS_MODULE_PATH, next: rendered.files.fontsModule, current: fontsFile }]
      : []),
```

The existing change and guard logic then covers it unchanged: a changed module is written with its sha (or null = must-not-exist in base mode), and an unchanged one rides along as a same-blob guard. Update the header comment: "…and the managed design-overrides.css region — plus, on L2+ drafts, the regenerated src/app/fonts.generated.ts…".

- [ ] **Step 4: `commitDesignVersion` uses both reads**

In `lib/design/commit-version.ts`, where Task 16 introduced `capRead`:
- import `fontsUnlocked` from `./capabilities` and `themeFilePaths` from `./drift`;
- after the violations check, add `const paths = themeFilePaths(capRead.draft)`;
- pass `fontsModule: fontsUnlocked(capRead.draft)` into `applyBundleToDraft({ … })`;
- pass `paths` as the third argument to EVERY `mergeAppliedBlobs(…)` call in the file (the skip-if-unchanged return and the three applied-blobs branches);
- update header step 5 to: `the FULL post-apply blob map — four theme files, plus the fonts module on L2+ drafts (the applied_blobs contract)`.

- [ ] **Step 5: Drift paths in chat, state and import**

- `lib/design/chat-turn.ts`: import `themeFilePaths`. Change the drift line to `computeDrift(snapshot.shas, latest ? { … } : null, themeFilePaths(capRead.draft))`.
- `app/api/edit/[id]/design/route.ts`:
  - import `readDesignCapabilities` (`@/lib/design/capabilities-read`), `fontsUnlocked` (`@/lib/design/capabilities`), and `themeFilePaths`, `mergeAppliedBlobs`, `isFontsModuleStale` (`@/lib/design/drift`);
  - read `const draftCaps = await readDesignCapabilities(ctx.githubRepo)` after the snapshot, then `const paths = themeFilePaths(draftCaps)`;
  - pass `appliedBlobs: mergeAppliedBlobs(snapshot.shas, {}, paths)` to `getBaselineOrCreate` (was `snapshot.shas`);
  - pass `paths` to `computeDrift`;
  - add `fontsModuleStale: fontsUnlocked(draftCaps) ? isFontsModuleStale(snapshot.texts) : null` to `state`.
- `app/api/edit/[id]/design/versions/import/route.ts`: same `draftCaps` / `paths` read. Use `computeDrift(…, paths)` and `mergeAppliedBlobs(snapshot.shas, {}, paths)`.
- `lib/design/studio-types.ts`: add to `DesignStudioState`, after `themeCssStale`:

```ts
  // true = the committed src/app/fonts.generated.ts ≠ what design.json generates
  // (L2+ drafts only); null = not applicable / can't tell.
  fontsModuleStale: boolean | null
```

- [ ] **Step 6: The Controls route writes the module on L2+ drafts**

In `app/api/edit/[id]/theme/route.ts`:
- import `readDesignCapabilities` (`@/lib/design/capabilities-read`), `fontsUnlocked` (`@/lib/design/capabilities`), `FONTS_MODULE_PATH` (`@/lib/design/drift`) and `generateFontsModule` (`@/lib/content/font-module-generator`);
- widen the `changes` array's element type to allow the extra entry;
- after the `changes` array is built, add:

```ts
    // L2+ drafts: the live fonts come from the generated next/font module, so
    // regenerate it from the FINAL design.json on every theme write (same as
    // theme.css) and guard it — an absent module must still be absent.
    if (fontsUnlocked(await readDesignCapabilities(githubRepo))) {
      const fontsFile = (await load(FONTS_MODULE_PATH, true))!
      const fontsModule = generateFontsModule(normalizeTypography(design.typography)).source
      changes.push({ path: FONTS_MODULE_PATH, content: fontsModule, expectedSha: fontsFile.sha || null })
    }
```

(An unchanged module is a same-blob write, so it guards without changing the tree, as the existing brand/design entries do.)

- [ ] **Step 7: The fonts-module notice in the Versions panel**

- `components/design-studio/DesignStudio.tsx`: pass `fontsModuleStale={state.fontsModuleStale}` to `<VersionsPanel>`.
- `components/design-studio/VersionsPanel.tsx`: add the prop `fontsModuleStale: boolean | null` (destructured and typed next to `themeCssStale`), and render after the theme.css notice:

```tsx
      {fontsModuleStale === true && (
        <div role="status" className="rounded-lg border border-border-default bg-surface-subtle px-3 py-2 font-body text-xs text-text-secondary">
          <p className="font-heading font-semibold text-text-primary">The live fonts are out of date</p>
          <p className="mt-0.5">
            src/app/fonts.generated.ts doesn’t match design.json, so the live site still loads older fonts. The next Studio apply, chat commit or
            Controls change regenerates it — and the fonts change on the live site when you publish.
          </p>
        </div>
      )}
```

- [ ] **Step 8: Run everything**

Run: `npx tsc --noEmit && npm test && npm run lint && npm run build`
Then the three CLAUDE.md greps.
Expected: all green; greps empty.

- [ ] **Step 9: Commit**

```bash
git add lib/design/apply-bundle.ts lib/design/apply-bundle.test.ts lib/design/commit-version.ts lib/design/commit-version.test.ts lib/design/chat-turn.ts \
  lib/design/studio-types.ts "app/api/edit/[id]/design/route.ts" "app/api/edit/[id]/design/route.test.ts" "app/api/edit/[id]/design/versions/import" \
  "app/api/edit/[id]/theme/route.ts" "app/api/edit/[id]/theme/route.test.ts" components/design-studio/DesignStudio.tsx components/design-studio/VersionsPanel.tsx
git commit -m "feat(design-studio): fonts reach the live site on L2+ templates (P6a)

Apply, chat commits, restores and Theme Studio Controls regenerate and
sha-guard src/app/fonts.generated.ts on drafts whose marker declares fonts.
applied_blobs gains the module on those drafts; drift ignores it for
versions recorded before it was tracked.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: [PLATFORM] Preview shows the chosen body font (`!important` font vars)

**Files:**
- Modify: `lib/theme-preview/compose-srcdoc.ts`
- Modify: `lib/theme-preview/compose-srcdoc.test.ts`

**Interfaces:**
- Produces: `composePreviewSrcDoc` injects `--font-{heading,body,accent}-loaded` as `!important`, so they beat the shell's inline `<html style>` alias.

- [ ] **Step 1: Write the failing test**

Add to `lib/theme-preview/compose-srcdoc.test.ts`:

```ts
it('font vars beat the shell’s inline --font-body-loaded alias (!important)', () => {
  const shellHtml = `<html style="--font-body-loaded: var(--font-heading-loaded)"><head>${THEME_SLOT}</head><body></body></html>`
  const doc = composePreviewSrcDoc({
    shellHtml,
    themeCss: '',
    overridesCss: '',
    typography: { headingFont: 'Lora', bodyFont: 'Inter', accentFont: 'Fraunces', googleFontsUrl: '' },
  })
  expect(doc).toContain('--font-body-loaded:"Inter",system-ui,sans-serif !important;')
  expect(doc).toContain('--font-heading-loaded:"Lora",system-ui,sans-serif !important;')
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/theme-preview/compose-srcdoc.test.ts`
Expected: FAIL on the new case.

- [ ] **Step 3: Implement**

In `fontHead` (`lib/theme-preview/compose-srcdoc.ts`), append ` !important` before each `;` of the three `--font-*-loaded` declarations:

```ts
  const vars =
    `:root{` +
    `--font-heading-loaded:"${attrSafe(headingFont || 'Public Sans')}",system-ui,sans-serif !important;` +
    `--font-body-loaded:"${attrSafe(bodyFont || 'Public Sans')}",system-ui,sans-serif !important;` +
    `--font-accent-loaded:"${attrSafe(accentFont || 'Fraunces')}",Georgia,"Times New Roman",serif !important;}`
```

Add a comment above it: `// !important: the template layout aliases --font-body-loaded (and, T1+, any shared-family role) with an INLINE <html style>, which beats any non-important stylesheet — without it a chosen body font never shows in the preview.` Update any existing snapshot or string assertion in this test file that pinned the old declarations.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/theme-preview lib/design && npx tsc --noEmit`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add lib/theme-preview/compose-srcdoc.ts lib/theme-preview/compose-srcdoc.test.ts
git commit -m "fix(design-studio): previews show a chosen body font over the inline alias

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

# Track T2 — Template: style axes + specimen

### Task 8: [TEMPLATE] Style-axis vocabulary + JSON contract + `design.json.style` type

**Files:**
- Create: `src/lib/theme/style-axes.ts`
- Create: `src/lib/theme/style-axes.test.ts`
- Modify: `src/lib/theme/types.ts`
- Modify: `scripts/generate-design-contracts.ts`
- Modify: `src/lib/theme/fonts-generated.test.ts` → rename to `src/lib/theme/design-contracts.test.ts` (it now checks both JSON contracts)
- Create (generated): `docs/design/style-axes.json`

**Interfaces:**
- Produces:
  - `STYLE_AXES` (a const object: axis → `{ attribute, summary, values }`);
  - `type StyleAxis`, `type StyleAxisValue<A>`, `type StyleAxes = { [A in StyleAxis]?: StyleAxisValue<A> }`;
  - `STYLE_AXIS_NAMES: StyleAxis[]`, `DEFAULT_AXIS_VALUE = 'default'`;
  - `styleAxisAttributes(style: unknown): Record<string, string>`;
  - `styleAxesJson(): string`;
  - `DesignJson.style?: StyleAxes`.
- Platform Task 20 mirrors `docs/design/style-axes.json`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/theme/style-axes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_AXIS_VALUE, STYLE_AXES, STYLE_AXIS_NAMES, styleAxesJson, styleAxisAttributes } from './style-axes'

describe('STYLE_AXES', () => {
  it('has the v1 axes, each with default first and 3–4 values', () => {
    expect(STYLE_AXIS_NAMES).toEqual(['sectionRhythm', 'cards', 'buttons', 'heroScale', 'imageTreatment', 'nav', 'footer', 'accentUsage'])
    for (const a of STYLE_AXIS_NAMES) {
      const values = STYLE_AXES[a].values as readonly string[]
      expect(values[0]).toBe(DEFAULT_AXIS_VALUE)
      expect(values.length).toBeGreaterThanOrEqual(3)
      expect(values.length).toBeLessThanOrEqual(4)
      expect(STYLE_AXES[a].attribute).toMatch(/^data-c5-[a-z-]+$/)
    }
  })
})

describe('styleAxisAttributes', () => {
  it.each([undefined, null, {}, [], 'x', { cards: 'default' }])('emits nothing for %j (R1)', (style) => {
    expect(styleAxisAttributes(style)).toEqual({})
  })
  it('maps non-default values to prefixed attributes', () => {
    expect(styleAxisAttributes({ cards: 'flat', nav: 'inverted', heroScale: 'default' })).toEqual({
      'data-c5-cards': 'flat',
      'data-c5-nav': 'inverted',
    })
  })
  it('ignores unknown axes and invalid values (never throws on hand-edited JSON)', () => {
    expect(styleAxisAttributes({ cards: 'wobbly', glitter: 'max', buttons: 7 })).toEqual({})
  })
})

describe('styleAxesJson', () => {
  it('serialises the vocabulary for the platform mirror', () => {
    expect(JSON.parse(styleAxesJson())).toEqual({ version: 1, defaultValue: 'default', axes: STYLE_AXES })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/theme/style-axes.test.ts`
Expected: FAIL — cannot resolve `./style-axes`.

- [ ] **Step 3: Implement the vocabulary**

Create `src/lib/theme/style-axes.ts`:

```ts
/**
 * Design Studio style axes (template T2). design.json `style` → <html data-c5-*>
 * attributes (layout.tsx) → presets in src/styles/style-axes.css. A value of
 * 'default' (or an absent axis) emits NO attribute, so an untouched site
 * matches no preset rule. The platform mirrors docs/design/style-axes.json
 * (onboarding lib/design/style-axes.ts) and parity-tests it.
 */
export const DEFAULT_AXIS_VALUE = 'default'

export const STYLE_AXES = {
  sectionRhythm: {
    attribute: 'data-c5-section-rhythm',
    summary: 'Vertical padding between sections: compact = tighter, generous = roomier.',
    values: ['default', 'compact', 'generous'],
  },
  cards: {
    attribute: 'data-c5-cards',
    summary: 'Card surfaces: flat = tinted fill no shadow, outlined = stronger hairline no shadow, elevated = deeper shadow.',
    values: ['default', 'flat', 'outlined', 'elevated'],
  },
  buttons: {
    attribute: 'data-c5-buttons',
    summary: 'Button shape: pill = fully rounded, sharp = square corners, bold = uppercase tracked labels.',
    values: ['default', 'pill', 'sharp', 'bold'],
  },
  heroScale: {
    attribute: 'data-c5-hero-scale',
    summary: 'Hero headline size: compact = smaller, dramatic = larger display type.',
    values: ['default', 'compact', 'dramatic'],
  },
  imageTreatment: {
    attribute: 'data-c5-image-treatment',
    summary: 'Framed images: natural = no brand grade, mono = greyscale, rounded = larger corner radius.',
    values: ['default', 'natural', 'mono', 'rounded'],
  },
  nav: {
    attribute: 'data-c5-nav',
    summary: 'Top navigation: bordered = hairline under the bar, inverted = primary-colour bar with light text.',
    values: ['default', 'bordered', 'inverted'],
  },
  footer: {
    attribute: 'data-c5-footer',
    summary: 'Footer surface: light = muted light surface, brand = primary colour.',
    values: ['default', 'light', 'brand'],
  },
  accentUsage: {
    attribute: 'data-c5-accent-usage',
    summary: 'The italic accent word in headlines: subtle = headline colour, plain = no accent styling, underline = action-colour underline.',
    values: ['default', 'subtle', 'plain', 'underline'],
  },
} as const

export type StyleAxis = keyof typeof STYLE_AXES
export type StyleAxisValue<A extends StyleAxis> = (typeof STYLE_AXES)[A]['values'][number]
export type StyleAxes = { [A in StyleAxis]?: StyleAxisValue<A> }
export const STYLE_AXIS_NAMES = Object.keys(STYLE_AXES) as StyleAxis[]

export function styleAxisAttributes(style: unknown): Record<string, string> {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return {}
  const out: Record<string, string> = {}
  for (const axis of STYLE_AXIS_NAMES) {
    const value = (style as Record<string, unknown>)[axis]
    const def = STYLE_AXES[axis]
    if (typeof value === 'string' && value !== DEFAULT_AXIS_VALUE && (def.values as readonly string[]).includes(value)) {
      out[def.attribute] = value
    }
  }
  return out
}

export function styleAxesJson(): string {
  return JSON.stringify({ version: 1, defaultValue: DEFAULT_AXIS_VALUE, axes: STYLE_AXES }, null, 2) + '\n'
}
```

- [ ] **Step 4: Type `design.json.style`**

In `src/lib/theme/types.ts`, add `import type { StyleAxes } from './style-axes'` at the top. Add after `darkSections?: boolean`:

```ts
  /** Design Studio style axes (T2). Absent / 'default' = today's look; see
   * src/lib/theme/style-axes.ts. layout.tsx maps it to <html data-c5-*>. */
  style?: StyleAxes
```

- [ ] **Step 5: Emit the JSON contract and test it**

- `scripts/generate-design-contracts.ts`: import `styleAxesJson` from `../src/lib/theme/style-axes`. Before the final `console.log`, add `await fs.writeFile(path.join(root, 'docs', 'design', 'style-axes.json'), styleAxesJson(), 'utf-8')`. Update the log line to mention `style-axes.json`.
- Rename the parity test: `git mv src/lib/theme/fonts-generated.test.ts src/lib/theme/design-contracts.test.ts`. Add inside its `describe`:

```ts
  it('docs/design/style-axes.json matches the vocabulary (run npm run design-contracts)', () => {
    expect(read('docs/design/style-axes.json')).toBe(styleAxesJson())
  })
```

  (Import `styleAxesJson` from `./style-axes`.)

Run: `npm run design-contracts`
Expected: `✓`, and `docs/design/style-axes.json` is created.

- [ ] **Step 6: Run the tests and types**

Run: `npm test && npx tsc --noEmit`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/theme/style-axes.ts src/lib/theme/style-axes.test.ts src/lib/theme/types.ts scripts/generate-design-contracts.ts \
  src/lib/theme/design-contracts.test.ts src/lib/theme/fonts-generated.test.ts docs/design/style-axes.json
git commit -m "feat(theme): style-axis vocabulary + docs/design/style-axes.json contract

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: [TEMPLATE] Inert hook attributes (button, headline accent, media grade, section spacing)

**Files:**
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/blocks/Section.tsx`
- Modify: `src/components/blocks/Hero.tsx`, `HeroSplit.tsx`, `PageHeader.tsx`, `IntroText.tsx` (the `font-accent` headline span)
- Modify: `src/components/ui/framed-media.tsx` (the duotone overlay span)
- Create: `src/lib/theme/hooks.test.ts`

**Interfaces:**
- Produces DOM hooks for Task 10's CSS:
  - `[data-c5="button"]` (every `Button`, including `asChild` links);
  - `[data-c5="headline-accent"]` (the promoted headline word; its inline `color` is KEPT);
  - `[data-c5="media-grade"]` (FramedMedia duotone overlay);
  - `[data-c5-spacing="compact"|"normal"|"spacious"]` on `Section`'s padded element (absent for `spacing="none"`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/theme/hooks.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/blocks/Section'

describe('style-axis hooks', () => {
  it('Button carries data-c5="button", including asChild links', () => {
    expect(renderToStaticMarkup(createElement(Button, null, 'Go'))).toContain('data-c5="button"')
    const link = renderToStaticMarkup(createElement(Button, { asChild: true }, createElement('a', { href: '/x' }, 'Go')))
    expect(link).toMatch(/^<a [^>]*data-c5="button"/)
  })
  it('Section marks its padded element with data-c5-spacing', () => {
    expect(renderToStaticMarkup(createElement(Section, { dataBlock: 'x' }, 'c'))).toMatch(/<section data-block="x" data-c5-spacing="normal"/)
    const bleed = renderToStaticMarkup(createElement(Section, { fullBleed: true, spacing: 'spacious' }, 'c'))
    expect(bleed).toMatch(/<div data-c5-spacing="spacious"/)
    expect(renderToStaticMarkup(createElement(Section, { spacing: 'none' }, 'c'))).not.toContain('data-c5-spacing')
  })
  it('every headline accent span and the media grade carry their hook', () => {
    for (const f of ['Hero', 'HeroSplit', 'PageHeader', 'IntroText']) {
      const src = readFileSync(path.join(process.cwd(), `src/components/blocks/${f}.tsx`), 'utf-8')
      expect(src, f).toContain(`<span className="font-accent" data-c5="headline-accent" style={{ color: 'var(--color-action)' }}>`)
    }
    expect(readFileSync(path.join(process.cwd(), 'src/components/ui/framed-media.tsx'), 'utf-8')).toContain('data-c5="media-grade"')
  })
  it('no stylesheet except src/styles/style-axes.css references data-c5 (R1)', () => {
    const css: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (p.endsWith('.css')) css.push(p)
      }
    }
    walk(path.join(process.cwd(), 'src'))
    css.push(path.join(process.cwd(), 'content', 'design-overrides.css'))
    const offenders = css.filter((p) => !p.endsWith(path.join('src', 'styles', 'style-axes.css')) && readFileSync(p, 'utf-8').includes('data-c5'))
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/theme/hooks.test.ts`
Expected: FAIL on the first three cases.

- [ ] **Step 3: Add the hooks**

`src/components/ui/button.tsx`: in the `Button` render, add the attribute BEFORE the props spread, so an explicit caller value still wins:

```tsx
      <Comp
        data-c5="button"
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
```

`src/components/blocks/Section.tsx`: add `const spacingHook = spacing === 'none' ? undefined : spacing` after `padClass`. Then (React renders attributes in prop order, and the test pins it):
- in the fullBleed branch, put `data-c5-spacing={spacingHook}` as the FIRST prop of the inner `<div …>` (before `className`);
- in the default branch, put it on `<Tag …>` right after `data-block={dataBlock}` (before `className`).

Add a comment: `// data-c5-spacing: inert hook for the Design Studio sectionRhythm axis (src/styles/style-axes.css).`

In `Hero.tsx`, `HeroSplit.tsx`, `PageHeader.tsx` and `IntroText.tsx`, change each

```tsx
      <span className="font-accent" style={{ color: 'var(--color-action)' }}>
```

to

```tsx
      <span className="font-accent" data-c5="headline-accent" style={{ color: 'var(--color-action)' }}>
```

`src/components/ui/framed-media.tsx`: add `data-c5="media-grade"` to the duotone overlay `<span aria-hidden …>`, directly after `aria-hidden`.

- [ ] **Step 4: Run the tests, types and the R1 pixel gate**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && npx playwright test e2e/zero-change.spec.ts e2e/design-defaults.spec.ts`
Expected: green; zero screenshot diffs (the hooks are inert).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/button.tsx src/components/blocks/Section.tsx src/components/blocks/Hero.tsx src/components/blocks/HeroSplit.tsx \
  src/components/blocks/PageHeader.tsx src/components/blocks/IntroText.tsx src/components/ui/framed-media.tsx src/lib/theme/hooks.test.ts
git commit -m "feat(theme): inert data-c5 hooks for the style axes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: [TEMPLATE] `style-axes.css`, cascade position, `<html data-c5-*>` from design.json

**Files:**
- Create: `src/styles/style-axes.css`
- Create: `src/lib/theme/style-axes-css.test.ts`
- Modify: `src/app/globals.css` (imports)
- Modify: `src/app/layout.tsx` (`<html>` attributes)
- Create: `e2e/style-axes.spec.ts`

**Interfaces:**
- Consumes: `STYLE_AXES`, `styleAxisAttributes` (Task 8); the hooks (Task 9).
- Produces:
  - the cascade `tailwindcss → theme.css → style-axes.css → design-overrides.css`;
  - `<html>` carries `data-c5-<axis>` for every non-default `design.json.style` value.

- [ ] **Step 1: Write the failing CSS contract test**

Create `src/lib/theme/style-axes-css.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_AXIS_VALUE, STYLE_AXES, STYLE_AXIS_NAMES } from './style-axes'

const css = readFileSync(path.join(process.cwd(), 'src/styles/style-axes.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')

// Every selector-list preceding a `{` that is not an at-rule.
function selectorLists(text: string): string[] {
  const out: string[] = []
  const re = /([^{};]+)\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const s = m[1].trim()
    if (!s.startsWith('@')) out.push(s)
  }
  return out
}
// Split on top-level commas only (:is(a, b) stays whole).
function splitSelectors(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of list) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  parts.push(cur.trim())
  return parts
}

const ATTR_RE = /^html\[(data-c5-[a-z-]+)="([a-z-]+)"\]/
const selectors = selectorLists(css).flatMap(splitSelectors)

describe('src/styles/style-axes.css', () => {
  it('gates EVERY selector on a known, non-default html axis attribute (R1: inert by default)', () => {
    expect(selectors.length).toBeGreaterThan(0)
    for (const sel of selectors) {
      const m = ATTR_RE.exec(sel)
      expect(m, sel).not.toBeNull()
      const axis = STYLE_AXIS_NAMES.find((a) => STYLE_AXES[a].attribute === m![1])
      expect(axis, sel).toBeDefined()
      expect(STYLE_AXES[axis!].values as readonly string[], sel).toContain(m![2])
      expect(m![2], sel).not.toBe(DEFAULT_AXIS_VALUE)
    }
  })
  it('implements every non-default value of every axis', () => {
    const used = new Set(selectors.map((s) => ATTR_RE.exec(s)).filter(Boolean).map((m) => `${m![1]}=${m![2]}`))
    for (const a of STYLE_AXIS_NAMES) {
      for (const v of STYLE_AXES[a].values) {
        if (v !== DEFAULT_AXIS_VALUE) expect(used, `${a}=${v}`).toContain(`${STYLE_AXES[a].attribute}=${v}`)
      }
    }
  })
  it('is imported after theme.css and before design-overrides.css', () => {
    const g = readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf-8')
    const i = (s: string) => g.indexOf(s)
    expect(i('@import "../styles/theme.css";')).toBeLessThan(i('@import "../styles/style-axes.css";'))
    expect(i('@import "../styles/style-axes.css";')).toBeLessThan(i('@import "../../content/design-overrides.css";'))
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/theme/style-axes-css.test.ts`
Expected: FAIL — ENOENT `style-axes.css`.

- [ ] **Step 3: Write `src/styles/style-axes.css`**

```css
/* style-axes.css — Design Studio style-axis presets (design.json "style").
 *
 * layout.tsx sets html[data-c5-<axis>] ONLY for non-default values, so every
 * rule below is inert on an untouched site (R1). Every selector MUST start with
 * html[data-c5-<axis>="<value>"] — enforced by src/lib/theme/style-axes-css.test.ts.
 *
 * Cascade: tailwindcss → theme.css → style-axes.css → content/design-overrides.css.
 * These rules are unlayered, so they beat Tailwind's layered utilities, and the
 * per-client overrides imported after still win on equal specificity.
 * Vocabulary: src/lib/theme/style-axes.ts (docs/design/style-axes.json).
 * Hooks: data-c5="button" | "headline-accent" | "media-grade", data-c5-spacing.
 * Tokens are re-scoped (e.g. --color-footer on the footer) rather than
 * restyling descendants, so every nested utility follows. */

/* ---- sectionRhythm (Section's padded element: data-c5-spacing) ---------- */
html[data-c5-section-rhythm="compact"] [data-c5-spacing="compact"] { padding-block: 2rem; }
html[data-c5-section-rhythm="compact"] [data-c5-spacing="normal"] { padding-block: 2.5rem; }
html[data-c5-section-rhythm="compact"] [data-c5-spacing="spacious"] { padding-block: 3.5rem; }
html[data-c5-section-rhythm="generous"] [data-c5-spacing="compact"] { padding-block: 3rem; }
html[data-c5-section-rhythm="generous"] [data-c5-spacing="normal"] { padding-block: 4.5rem; }
html[data-c5-section-rhythm="generous"] [data-c5-spacing="spacious"] { padding-block: 6rem; }
@media (min-width: 768px) {
  html[data-c5-section-rhythm="compact"] [data-c5-spacing="compact"] { padding-block: 2.5rem; }
  html[data-c5-section-rhythm="compact"] [data-c5-spacing="normal"] { padding-block: 3.5rem; }
  html[data-c5-section-rhythm="compact"] [data-c5-spacing="spacious"] { padding-block: 5rem; }
  html[data-c5-section-rhythm="generous"] [data-c5-spacing="compact"] { padding-block: 4.5rem; }
  html[data-c5-section-rhythm="generous"] [data-c5-spacing="normal"] { padding-block: 7rem; }
  html[data-c5-section-rhythm="generous"] [data-c5-spacing="spacious"] { padding-block: 10rem; }
}

/* ---- cards (.u-card surfaces) ------------------------------------------ */
html[data-c5-cards="flat"] .u-card { box-shadow: none; border-color: transparent; background: var(--color-muted); }
html[data-c5-cards="flat"] .u-card-interactive:hover { box-shadow: none; border-color: transparent; }
html[data-c5-cards="outlined"] .u-card { box-shadow: none; border-color: color-mix(in srgb, var(--color-primary) 28%, transparent); }
html[data-c5-cards="outlined"] .u-card-interactive:hover { box-shadow: none; border-color: var(--color-action); }
html[data-c5-cards="elevated"] .u-card { box-shadow: var(--shadow-lg); border-color: transparent; }
html[data-c5-cards="elevated"] .u-card-interactive:hover { box-shadow: var(--shadow-lg); transform: translateY(-4px); }

/* ---- buttons (data-c5="button") ---------------------------------------- */
html[data-c5-buttons="pill"] [data-c5="button"] { border-radius: 9999px; }
html[data-c5-buttons="sharp"] [data-c5="button"] { border-radius: 0; }
html[data-c5-buttons="bold"] [data-c5="button"] { text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }

/* ---- heroScale (re-scoped type tokens on the hero blocks) --------------- */
html[data-c5-hero-scale="compact"] :is([data-block="hero"], [data-block="hero-split"], [data-block="page-header"]) {
  --type-display: clamp(2.2rem, 1.3rem + 3vw, 3.25rem);
  --type-h1: clamp(1.8rem, 1.2rem + 1.8vw, 2.5rem);
}
html[data-c5-hero-scale="dramatic"] :is([data-block="hero"], [data-block="hero-split"], [data-block="page-header"]) {
  --type-display: clamp(3rem, 1.5rem + 5.6vw, 5.5rem);
  --type-h1: clamp(2.4rem, 1.5rem + 3.2vw, 3.75rem);
}

/* ---- imageTreatment (.u-frame + FramedMedia's data-c5="media-grade") ---- */
html[data-c5-image-treatment="natural"] .u-frame img { filter: none; }
html[data-c5-image-treatment="natural"] [data-c5="media-grade"] { display: none; }
html[data-c5-image-treatment="mono"] .u-frame img { filter: grayscale(1) contrast(1.05); }
html[data-c5-image-treatment="mono"] [data-c5="media-grade"] { display: none; }
html[data-c5-image-treatment="rounded"] .u-frame { border-radius: var(--radius-lg); }

/* ---- nav ([data-component="navbar"]) ----------------------------------- */
html[data-c5-nav="bordered"] [data-component="navbar"] { border-bottom: 1px solid var(--color-border); }
html[data-c5-nav="inverted"] [data-component="navbar"] {
  --color-background: var(--color-primary);
  --color-foreground: var(--color-primary-foreground);
  --color-muted-foreground: color-mix(in srgb, var(--color-primary-foreground) 75%, transparent);
  --color-border: color-mix(in srgb, var(--color-primary-foreground) 18%, transparent);
  color: var(--color-foreground);
}

/* ---- footer ([data-component="footer"]: re-scope the footer tokens) ---- */
html[data-c5-footer="light"] [data-component="footer"] {
  --color-footer: var(--color-muted);
  --color-footer-foreground: var(--color-foreground);
  border-top: 1px solid var(--color-border);
}
html[data-c5-footer="brand"] [data-component="footer"] {
  --color-footer: var(--color-primary);
  --color-footer-foreground: var(--color-primary-foreground);
}

/* ---- accentUsage (data-c5="headline-accent") ----------------------------
 * The accent colour is an INLINE style (kept so existing client overrides
 * behave exactly as before), so colour changes here need !important. */
html[data-c5-accent-usage="subtle"] [data-c5="headline-accent"] { color: inherit !important; }
html[data-c5-accent-usage="plain"] [data-c5="headline-accent"] { color: inherit !important; font-family: inherit; font-style: inherit; font-weight: inherit; }
html[data-c5-accent-usage="underline"] [data-c5="headline-accent"] {
  color: inherit !important;
  font-family: inherit;
  font-style: inherit;
  font-weight: inherit;
  text-decoration: underline;
  text-decoration-color: var(--color-action);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.14em;
}
```

- [ ] **Step 4: Import it between theme.css and the overrides**

In `src/app/globals.css`, change the first three lines to:

```css
@import "tailwindcss";
@import "../styles/theme.css";
@import "../styles/style-axes.css";
@import "../../content/design-overrides.css";
```

Also update the cascade comment at the top of `content/design-overrides.css` from `tailwindcss → theme.css → design-overrides.css` to `tailwindcss → theme.css → style-axes.css → design-overrides.css`. (Comment only; the file contains no `data-c5`.)

- [ ] **Step 5: Set the attributes on `<html>`**

In `src/app/layout.tsx`, add `import { styleAxisAttributes } from '@/lib/theme/style-axes'`. On the `<html>` element, directly after the `data-eyebrow=…` attribute, add:

```tsx
      // Design Studio style axes (design.json "style"). Only NON-default values
      // emit an attribute, so untouched sites match no style-axes.css rule.
      {...styleAxisAttributes(design.style)}
```

- [ ] **Step 6: Write the per-axis pixel-diff e2e (CI-safe: it compares within the run)**

Create `e2e/style-axes.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

/**
 * Each non-default style-axis value must visibly change the home page
 * (the spec's "screenshot diffs for each axis value"). Sets the attribute on
 * <html> in-page — exactly what layout.tsx emits from design.json.style — so
 * no rebuild per value. Compares within one run, so it is CI-safe.
 */
const AXES: Record<string, string[]> = {
  'data-c5-section-rhythm': ['compact', 'generous'],
  'data-c5-cards': ['flat', 'outlined', 'elevated'],
  'data-c5-buttons': ['pill', 'sharp', 'bold'],
  'data-c5-hero-scale': ['compact', 'dramatic'],
  'data-c5-image-treatment': ['natural', 'mono', 'rounded'],
  'data-c5-nav': ['bordered', 'inverted'],
  'data-c5-footer': ['light', 'brand'],
  'data-c5-accent-usage': ['subtle', 'plain', 'underline'],
}

test.describe.configure({ mode: 'serial' })

test('every non-default axis value changes the rendered page', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  const shot = () => page.screenshot({ fullPage: true, animations: 'disabled' })
  const baseline = await shot()
  for (const [attr, values] of Object.entries(AXES)) {
    for (const value of values) {
      await page.evaluate(([a, v]) => document.documentElement.setAttribute(a, v), [attr, value])
      const changed = await shot()
      expect(Buffer.compare(baseline, changed), `${attr}="${value}" had no visible effect`).not.toBe(0)
      await page.evaluate((a) => document.documentElement.removeAttribute(a), attr)
    }
  }
  expect(Buffer.compare(baseline, await shot())).toBe(0)
})
```

- [ ] **Step 7: Run everything, including the R1 gate**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && npm run test:e2e && npx playwright test e2e/zero-change.spec.ts`
Expected:
- all green;
- `style-axes.spec.ts` passes, so every value is visible. If one value shows no effect, inspect that component's markup and tighten its rule. Never remove the value from the test;
- zero-change has zero diffs.

Also check the `nav=inverted` / `footer=light` contrast by eye: `npm run start`, set the attribute in devtools, and confirm the text stays readable.

- [ ] **Step 8: Commit**

```bash
git add src/styles/style-axes.css src/lib/theme/style-axes-css.test.ts src/app/globals.css content/design-overrides.css src/app/layout.tsx e2e/style-axes.spec.ts
git commit -m "feat(theme): style-axis presets via html[data-c5-*] (inert by default)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: [TEMPLATE] Extract showcase samples to `src/lib/showcase/samples.ts`

**Files:**
- Create: `src/lib/showcase/samples.ts`
- Create: `src/lib/showcase/samples.test.ts`
- Modify: `src/app/showcase/page.tsx`

**Interfaces:**
- Produces:
  - `SAMPLE_CONTENT: Record<string, string>`;
  - `SAMPLE_FAQ: FaqItem[]`;
  - `makeSampleSection(blockId: string): PageSection`;
  - `makeSampleManifest(url?: string, title?: string): PageManifest`;
  - `makeSampleHeroManifest(kind: 'hero' | 'hero-split' | 'page-header'): PageManifest`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/showcase/samples.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { KNOWN_BLOCK_IDS } from '@/components/assembly/block-registry'
import { SAMPLE_CONTENT, makeSampleHeroManifest, makeSampleManifest, makeSampleSection } from './samples'

describe('showcase samples', () => {
  it('only samples known blocks', () => {
    for (const id of Object.keys(SAMPLE_CONTENT)) expect(KNOWN_BLOCK_IDS).toContain(id)
  })
  it('builds a titled section per block (empty content when unsampled)', () => {
    expect(makeSampleSection('feature-grid')).toMatchObject({ blockId: 'feature-grid', heading: 'Feature Grid', position: 0 })
    expect(makeSampleSection('map').content).toBe('')
  })
  it('the sample manifest carries the FAQ the faq-accordion block reads', () => {
    expect(makeSampleManifest().faq_block?.length).toBe(2)
  })
  it.each(['hero', 'hero-split', 'page-header'] as const)('builds a %s hero manifest', (kind) => {
    const m = makeSampleHeroManifest(kind)
    expect(m.hero_block).toBe(kind)
    expect(m.hero_headline).toContain('*')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/showcase/samples.test.ts`
Expected: FAIL — cannot resolve `./samples`.

- [ ] **Step 3: Move the samples**

Create `src/lib/showcase/samples.ts`:
- Move `SAMPLE_CONTENT` VERBATIM from `src/app/showcase/page.tsx`, adding `export`.
- Convert `makeSection` / `makeManifest` into the functions below (same bodies, parameterised):

```ts
/**
 * Synthetic-but-realistic block content shared by the dev-only /showcase and
 * the production /design-specimen fallback (a block the client's pages never
 * use is shown with this sample instead).
 */
import type { FaqItem, PageManifest, PageSection } from '@/lib/assembly/parse-page-md'

export const SAMPLE_CONTENT: Record<string, string> = {
  /* …moved verbatim from src/app/showcase/page.tsx… */
}

export const SAMPLE_FAQ: FaqItem[] = [
  { question: 'Do you serve clients outside Massachusetts?', answer: 'Yes — we work with clients across New England and beyond.' },
  { question: 'Do you offer fixed-fee engagements?', answer: 'For most recurring work, yes. We scope every engagement up front.' },
]

export function makeSampleSection(blockId: string): PageSection {
  return {
    blockId,
    heading: blockId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    content: SAMPLE_CONTENT[blockId] ?? '',
    position: 0,
  }
}

export function makeSampleManifest(url = '/showcase', title = 'Showcase'): PageManifest {
  return {
    title,
    url,
    meta_title: title,
    meta_description: '',
    target_keyword: '',
    canonical_url: '',
    schema_markup: 'WebPage',
    hero_block: 'page-header',
    sections: [],
    faq_block: SAMPLE_FAQ,
  }
}

export function makeSampleHeroManifest(kind: 'hero' | 'hero-split' | 'page-header'): PageManifest {
  return {
    ...makeSampleManifest('/design-specimen', 'Sample page'),
    hero_block: kind,
    hero_variant: kind === 'hero' ? 'statement' : kind === 'hero-split' ? 'image-right' : undefined,
    hero_headline: 'Three generations of CPAs who actually *answer*.',
    hero_eyebrow: 'Sample · Since 1972',
    hero_subhead: 'Boutique tax, advisory, and audit for closely held businesses.',
  }
}
```

In `src/app/showcase/page.tsx`:
- delete `SAMPLE_CONTENT`, `makeSection` and `makeManifest`;
- add `import { makeSampleManifest, makeSampleSection } from '@/lib/showcase/samples'`;
- replace `makeManifest()` with `makeSampleManifest()` and `makeSection(id)` with `makeSampleSection(id)`;
- remove the now-unused `PageSection` / `PageManifest` type import.

- [ ] **Step 4: Run the tests, types and lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: green. `/showcase` is dev-only (404 in production), so it has no e2e.

- [ ] **Step 5: Commit**

```bash
git add src/lib/showcase/samples.ts src/lib/showcase/samples.test.ts src/app/showcase/page.tsx
git commit -m "feat(theme): extract showcase SAMPLE_CONTENT to src/lib/showcase/samples.ts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: [TEMPLATE] Specimen instance selection (pure) + cached page loading

**Files:**
- Create: `src/lib/specimen/pick-instances.ts`
- Create: `src/lib/specimen/pick-instances.test.ts`
- Create: `src/lib/specimen/load-pages.ts`

**Interfaces:**
- Consumes: `makeSampleSection`, `makeSampleManifest`, `makeSampleHeroManifest` (Task 11); `PageManifest`, `PageSection`.
- Produces:
  - `HERO_KINDS = ['hero', 'hero-split', 'page-header'] as const`;
  - `type SpecimenPage = { url: string; manifest: PageManifest }`;
  - `type SpecimenHero = { kind: HeroKind; source: 'page' | 'sample'; pageUrl: string | null; manifest: PageManifest }`;
  - `type SpecimenBlock = { blockId: string; source: 'page' | 'sample'; pageUrl: string | null; section: PageSection; manifest: PageManifest }`;
  - `pickSpecimenInstances(pages: SpecimenPage[], knownBlockIds: readonly string[]): { heroes: SpecimenHero[]; blocks: SpecimenBlock[] }`;
  - `loadSpecimenPages(): Promise<SpecimenPage[]>` (home first, then slugs sorted).

- [ ] **Step 1: Write the failing test**

Create `src/lib/specimen/pick-instances.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { PageManifest, PageSection } from '@/lib/assembly/parse-page-md'
import { makeSampleManifest } from '@/lib/showcase/samples'
import { pickSpecimenInstances } from './pick-instances'

const sec = (blockId: string, heading: string): PageSection => ({ blockId, heading, content: `${heading} body`, position: 0 })
const page = (url: string, hero: string, sections: PageSection[]): { url: string; manifest: PageManifest } => ({
  url,
  manifest: { ...makeSampleManifest(url, url), hero_block: hero, sections },
})

describe('pickSpecimenInstances', () => {
  const pages = [
    page('/', 'hero', [sec('intro-text', 'Home intro'), sec('feature-grid', 'Home grid')]),
    page('/about', 'page-header', [sec('intro-text', 'About intro'), sec('team-grid', 'Team')]),
  ]
  const { heroes, blocks } = pickSpecimenInstances(pages, ['feature-grid', 'intro-text', 'team-grid', 'map'])

  it('takes the FIRST real instance of each block, in page order', () => {
    expect(blocks.find((b) => b.blockId === 'intro-text')).toMatchObject({ source: 'page', pageUrl: '/', section: { heading: 'Home intro' } })
    expect(blocks.find((b) => b.blockId === 'team-grid')).toMatchObject({ source: 'page', pageUrl: '/about' })
  })
  it('falls back to the showcase sample for blocks no page uses', () => {
    expect(blocks.find((b) => b.blockId === 'map')).toMatchObject({ source: 'sample', pageUrl: null, section: { blockId: 'map' } })
  })
  it('keeps the known-block order', () => {
    expect(blocks.map((b) => b.blockId)).toEqual(['feature-grid', 'intro-text', 'team-grid', 'map'])
  })
  it('picks one hero per kind, sampling the missing ones', () => {
    expect(heroes.map((h) => [h.kind, h.source, h.pageUrl])).toEqual([
      ['hero', 'page', '/'],
      ['hero-split', 'sample', null],
      ['page-header', 'page', '/about'],
    ])
  })
  it('works with no pages at all (fresh template)', () => {
    const r = pickSpecimenInstances([], ['intro-text'])
    expect(r.blocks[0].source).toBe('sample')
    expect(r.heroes.every((h) => h.source === 'sample')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/specimen/pick-instances.test.ts`
Expected: FAIL — cannot resolve `./pick-instances`.

- [ ] **Step 3: Implement the selection**

Create `src/lib/specimen/pick-instances.ts`:

```ts
/**
 * Pure: choose what /design-specimen shows — the FIRST real instance of each
 * block across the client's pages (home first, then the other pages in slug
 * order), falling back to the showcase sample for blocks no page uses. Heroes
 * are page-level (manifest.hero_block), one per kind.
 */
import type { PageManifest, PageSection } from '@/lib/assembly/parse-page-md'
import { makeSampleHeroManifest, makeSampleManifest, makeSampleSection } from '@/lib/showcase/samples'

export const HERO_KINDS = ['hero', 'hero-split', 'page-header'] as const
export type HeroKind = (typeof HERO_KINDS)[number]

export type SpecimenPage = { url: string; manifest: PageManifest }
export type SpecimenHero = { kind: HeroKind; source: 'page' | 'sample'; pageUrl: string | null; manifest: PageManifest }
export type SpecimenBlock = {
  blockId: string
  source: 'page' | 'sample'
  pageUrl: string | null
  section: PageSection
  manifest: PageManifest
}

export function pickSpecimenInstances(
  pages: SpecimenPage[],
  knownBlockIds: readonly string[],
): { heroes: SpecimenHero[]; blocks: SpecimenBlock[] } {
  const heroes: SpecimenHero[] = HERO_KINDS.map((kind) => {
    const hit = pages.find((p) => p.manifest.hero_block === kind)
    return hit
      ? { kind, source: 'page', pageUrl: hit.url, manifest: hit.manifest }
      : { kind, source: 'sample', pageUrl: null, manifest: makeSampleHeroManifest(kind) }
  })

  const sampleManifest = makeSampleManifest('/design-specimen', 'Sample page')
  const blocks: SpecimenBlock[] = knownBlockIds.map((blockId) => {
    for (const p of pages) {
      const section = p.manifest.sections.find((s) => s.blockId === blockId)
      if (section) return { blockId, source: 'page', pageUrl: p.url, section, manifest: p.manifest }
    }
    return { blockId, source: 'sample', pageUrl: null, section: makeSampleSection(blockId), manifest: sampleManifest }
  })

  return { heroes, blocks }
}
```

- [ ] **Step 4: Implement the cached loader**

Create `src/lib/specimen/load-pages.ts`:

```ts
import { getPageMarkdown, listPageSlugs } from '@/lib/content/get-page'
import { parsePageMd } from '@/lib/assembly/parse-page-md'
import type { SpecimenPage } from './pick-instances'

/**
 * The client's pages for /design-specimen: home first, then every other page
 * in slug order. Built only from the 'use cache' loaders (getPageMarkdown /
 * listPageSlugs), so the specimen prerenders like every other page. Malformed
 * pages are skipped (the real route 404s them too).
 */
export async function loadSpecimenPages(): Promise<SpecimenPage[]> {
  const slugs = [...(await listPageSlugs())].sort()
  const urls = ['/', ...slugs.map((s) => `/${s.replace(/--/g, '/')}`)]
  const pages: SpecimenPage[] = []
  for (const url of urls) {
    const md = await getPageMarkdown(url)
    if (!md) continue
    try {
      pages.push({ url, manifest: parsePageMd(md) })
    } catch {
      // Malformed page — skipped, same as the catch-all route's notFound().
    }
  }
  return pages
}
```

- [ ] **Step 5: Run the tests and types**

Run: `npx vitest run src/lib/specimen && npx tsc --noEmit`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/specimen/pick-instances.ts src/lib/specimen/pick-instances.test.ts src/lib/specimen/load-pages.ts
git commit -m "feat(theme): specimen instance selection (first real block, sample fallback)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: [TEMPLATE] `/design-specimen` route (noindex, unlinked, static, no JS needed)

**Files:**
- Create: `src/app/design-specimen/page.tsx`
- Modify: `next.config.ts` (`headers()`)
- Create: `e2e/design-specimen.spec.ts`

**Interfaces:**
- Consumes: `loadSpecimenPages`, `pickSpecimenInstances` (Task 12); `BLOCK_REGISTRY`, `KNOWN_BLOCK_IDS`; `Hero`, `HeroSplit`, `PageHeader` and their extractors.
- Produces:
  - `GET /design-specimen` → 200, with each instance wrapped in `<div data-specimen-block="<id>" data-specimen-source="page|sample">`;
  - heroes wrapped in `data-specimen-hero="<kind>"`;
  - `X-Robots-Tag: noindex, nofollow`.

- [ ] **Step 1: Write the failing e2e**

Create `e2e/design-specimen.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const CONTENT_BLOCKS = ['intro-text', 'feature-grid', 'content-split', 'cta-banner', 'service-cards', 'faq-accordion', 'testimonials', 'stats-bar']

test('renders every block once with no JavaScript (static, no client JS needed)', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false })
  const page = await ctx.newPage()
  const res = await page.goto('/design-specimen')
  expect(res?.status()).toBe(200)
  for (const id of CONTENT_BLOCKS) {
    await expect(page.locator(`[data-specimen-block="${id}"] [data-block="${id}"]`).first()).toBeAttached()
  }
  for (const kind of ['hero', 'hero-split', 'page-header']) {
    await expect(page.locator(`[data-specimen-hero="${kind}"]`)).toHaveCount(1)
  }
  // The template's own home.md uses intro-text → it is a REAL instance.
  await expect(page.locator('[data-specimen-block="intro-text"]')).toHaveAttribute('data-specimen-source', 'page')
  await ctx.close()
})

test('is noindex (meta + header)', async ({ page }) => {
  const res = await page.goto('/design-specimen')
  expect(res?.headers()['x-robots-tag']).toBe('noindex, nofollow')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('is not in the sitemap or llms.txt, and not linked from the home page', async ({ page, request }) => {
  expect(await (await request.get('/sitemap.xml')).text()).not.toContain('design-specimen')
  expect(await (await request.get('/llms.txt')).text()).not.toContain('design-specimen')
  await page.goto('/')
  await expect(page.locator('a[href*="design-specimen"]')).toHaveCount(0)
})
```

- [ ] **Step 2: Build and run it to make sure it fails**

Run: `npm run build && npx playwright test e2e/design-specimen.spec.ts`
Expected: FAIL — `/design-specimen` is 404.

- [ ] **Step 3: Write the route**

Create `src/app/design-specimen/page.tsx`:

```tsx
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Section } from '@/components/blocks/Section'
import { BLOCK_REGISTRY, KNOWN_BLOCK_IDS } from '@/components/assembly/block-registry'
import { Hero } from '@/components/blocks/Hero'
import { HeroSplit } from '@/components/blocks/HeroSplit'
import { PageHeader } from '@/components/blocks/PageHeader'
import { extractHeroProps, extractHeroSplitProps, extractPageHeaderProps } from '@/lib/assembly/extract-block-props'
import { loadSpecimenPages } from '@/lib/specimen/load-pages'
import { pickSpecimenInstances, type SpecimenHero } from '@/lib/specimen/pick-instances'

/**
 * Design specimen (template T2, capability "specimen"). Every block rendered
 * once — the FIRST real instance from this site's own pages, else the
 * showcase sample — so the Revaltus Design Studio can render and critique a
 * design against the whole block vocabulary in one page.
 *
 * Production route, but: noindex (meta here + X-Robots-Tag in next.config),
 * not in the sitemap / llms.txt (both are built from content pages), linked
 * from nowhere. Static: only 'use cache' loaders, server components only.
 */
export const metadata: Metadata = {
  title: 'Design specimen',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
}

function renderHero(h: SpecimenHero): ReactNode {
  if (h.kind === 'hero') return <Hero {...extractHeroProps(h.manifest)} />
  if (h.kind === 'hero-split') return <HeroSplit {...extractHeroSplitProps(h.manifest)} />
  return <PageHeader {...extractPageHeaderProps(h.manifest)} />
}

function Label({ id, source, pageUrl }: { id: string; source: 'page' | 'sample'; pageUrl: string | null }) {
  return (
    <Section as="div" spacing="none" className="border-t border-border py-3">
      <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
        {id} · {source === 'page' ? `from ${pageUrl}` : 'sample content'}
      </p>
    </Section>
  )
}

export default async function DesignSpecimen() {
  const pages = await loadSpecimenPages()
  const { heroes, blocks } = pickSpecimenInstances(pages, KNOWN_BLOCK_IDS)
  return (
    <main id="main-content" className="flex-1" data-specimen>
      {heroes.map((h) => (
        <div key={h.kind} data-specimen-hero={h.kind} data-specimen-source={h.source}>
          <Label id={h.kind} source={h.source} pageUrl={h.pageUrl} />
          {renderHero(h)}
        </div>
      ))}
      {blocks.map((b) => {
        const render = BLOCK_REGISTRY[b.blockId]
        if (!render) return null
        return (
          <div key={b.blockId} data-specimen-block={b.blockId} data-specimen-source={b.source}>
            <Label id={b.blockId} source={b.source} pageUrl={b.pageUrl} />
            {render(b.section, b.manifest)}
          </div>
        )
      })}
    </main>
  )
}
```

- [ ] **Step 4: Add the `X-Robots-Tag` header**

In `next.config.ts` `headers()`, change the final `return` to:

```ts
    return [
      { source: '/:path*', headers: baseHeaders },
      // /design-specimen is a production page for the Design Studio only —
      // never indexed. (robots.txt deliberately does NOT disallow it: a
      // disallowed URL is never fetched, so its noindex would go unseen.)
      { source: '/design-specimen', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ]
```

- [ ] **Step 5: Run everything**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && npm run test:e2e`
Expected: green. The build output lists `/design-specimen` as prerendered (○ or ◐, not ƒ). If it is dynamic, find the non-cached read and wrap it; never add `export const dynamic`.

- [ ] **Step 6: Commit**

```bash
git add src/app/design-specimen/page.tsx next.config.ts e2e/design-specimen.spec.ts
git commit -m "feat(theme): /design-specimen — every block once, noindex, unlinked

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: [TEMPLATE] T2 release — marker bump, docs, full verification

**Files:**
- Modify: `c5-template.json`
- Modify: `src/lib/theme/template-marker.test.ts`
- Modify: `e2e/design-defaults.spec.ts`
- Modify: `CHANGELOG.md`, `docs/architecture.md`

**Interfaces:**
- Produces: marker `{"templateVersion": "2026.09.2", "capabilities": ["fonts", "style-axes", "specimen"]}` and meta `content="fonts,style-axes,specimen"`, which is L4 on the platform.

- [ ] **Step 1: Update the tests first**

- `src/lib/theme/template-marker.test.ts`: change the R2 expectation to `{ templateVersion: '2026.09.2', capabilities: ['fonts', 'style-axes', 'specimen'] }` and the test name to "declares exactly the T2 capabilities (R2)".
- `e2e/design-defaults.spec.ts`: change the meta expectation to `'fonts,style-axes,specimen'`.

Run: `npx vitest run src/lib/theme/template-marker.test.ts`
Expected: FAIL.

- [ ] **Step 2: Bump the marker**

`c5-template.json`:

```json
{
  "templateVersion": "2026.09.2",
  "capabilities": ["fonts", "style-axes", "specimen"]
}
```

- [ ] **Step 3: Document**

Prepend to `CHANGELOG.md` (above the 2026.09.1 entry):

```markdown
## [2026.09.2] — Design Studio T2: style axes + design specimen

### Added
- **Style axes.** `design.json.style` (sectionRhythm, cards, buttons, heroScale,
  imageTreatment, nav, footer, accentUsage — see `src/lib/theme/style-axes.ts`,
  mirrored at `docs/design/style-axes.json`) → `<html data-c5-*>` → presets in
  `src/styles/style-axes.css` (imported between theme.css and the overrides).
  `default` / absent emits nothing: untouched sites are unchanged.
- Inert hooks: `data-c5="button"`, `data-c5="headline-accent"`,
  `data-c5="media-grade"`, `data-c5-spacing`.
- **`/design-specimen`** — every block once (first real instance from the site's
  pages, else the showcase sample). noindex + `X-Robots-Tag`, not in the sitemap,
  unlinked. Samples now live in `src/lib/showcase/samples.ts`.
- `c5-template.json` capabilities: `fonts`, `style-axes`, `specimen`.
```

Append to `docs/architecture.md`:

```markdown
## Design Studio contracts (T1/T2)

The Revaltus Design Studio drives four template levers. Each has one source file here
and a mirror + parity test on the platform:

| Lever | Template source | Platform mirror |
|---|---|---|
| Capability marker | `c5-template.json` + `<meta name="c5-capabilities">` | `lib/design/capabilities.ts` |
| Live fonts | `src/lib/theme/font-{manifest,module}.ts` → `src/app/fonts.generated.ts` (`npm run generate-fonts`) | `lib/content/font-{manifest,module-generator}.ts` + goldens |
| Style axes | `src/lib/theme/style-axes.ts` + `src/styles/style-axes.css` | `lib/design/style-axes.ts` + `docs/design/style-axes.json` |
| Specimen | `src/app/design-specimen/page.tsx` | the page picker (`lib/design/pages.ts`) |

After changing a contract, run `npm run design-contracts` and re-copy the JSON / golden
files into the platform fixtures.
```

- [ ] **Step 4: Full verification (R1 included)**

Run:
`npm test && npm run lint && npx tsc --noEmit && npm run validate && npx tsx scripts/generate-fonts.ts --check && npm run build && npm run test:e2e && npx playwright test e2e/zero-change.spec.ts && git diff a540d1e --stat -- src/styles/theme.css scripts/generate-theme.ts`

Expected:
- all green;
- zero-change has zero pixel diffs against the `a540d1e` baseline;
- the final `git diff` prints nothing (`theme.css` and its generator are untouched).

- [ ] **Step 5: Commit**

```bash
git add c5-template.json src/lib/theme/template-marker.test.ts e2e/design-defaults.spec.ts CHANGELOG.md docs/architecture.md
git commit -m "feat(theme): template 2026.09.2 — style axes + specimen capabilities (T2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Hand-off**

Do not merge or push to `main` from this plan. The T3 rollout decides how the template reaches `main` and the fleet (the spec says show the roster first). Report the branch head sha.

---

# Track P6b — Platform: style axes + specimen

> Start once Task 8's `docs/design/style-axes.json` exists. The template Tasks 9–14 need not be finished.

### Task 20: [PLATFORM] Style-axes mirror + parity fixture + `design.json.style` + `patchDesignStyle`

**Files:**
- Create: `lib/design/style-axes.ts`
- Create: `lib/design/style-axes.test.ts`
- Create (copied): `lib/design/__fixtures__/style-axes.template.json`
- Modify: `types/design-json.ts`
- Modify: `lib/editor/theme-edit.ts` (+ `lib/editor/theme-edit.test.ts`)

**Interfaces:**
- Produces:
  - `STYLE_AXES`, `StyleAxis`, `StyleAxisValue<A>`, `StyleAxes`, `STYLE_AXIS_NAMES`, `DEFAULT_AXIS_VALUE`, `styleAxesJson()` (identical to the template);
  - `STYLE_AXIS_ATTRIBUTES: readonly string[]`;
  - `StyleAxesInputSchema` (a zod object, every axis optional);
  - `canonicalStyle(style: StyleAxes | undefined): StyleAxes | undefined` (drops defaults and unknowns; `undefined` when empty);
  - `normalizeStyleAxes(value: unknown): StyleAxes | undefined`;
  - `styleAxisHtmlAttributes(style: unknown): Record<string, string | null>` (all 8 attributes; `null` = remove);
  - `styleAxesSummary(): string`;
  - `DesignJson.style?: Record<string, string>`;
  - `patchDesignStyle(designJsonText: string, patch: StyleAxes): DesignPatchResult`.

- [ ] **Step 1: Copy the template contract**

Run: `cp /Users/webhank/LocalSites/counting-five-client-template/docs/design/style-axes.json lib/design/__fixtures__/style-axes.template.json`

- [ ] **Step 2: Write the failing tests**

Create `lib/design/style-axes.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  STYLE_AXIS_ATTRIBUTES,
  StyleAxesInputSchema,
  canonicalStyle,
  normalizeStyleAxes,
  styleAxesJson,
  styleAxisHtmlAttributes,
} from './style-axes'

describe('style axes mirror', () => {
  it('matches the template docs/design/style-axes.json byte for byte', () => {
    expect(styleAxesJson()).toBe(readFileSync(path.join(__dirname, '__fixtures__', 'style-axes.template.json'), 'utf-8'))
  })
  it('lists the 8 html attributes', () => {
    expect(STYLE_AXIS_ATTRIBUTES).toHaveLength(8)
    expect(STYLE_AXIS_ATTRIBUTES).toContain('data-c5-cards')
  })
})

describe('canonical style', () => {
  it('drops defaults and becomes undefined when empty', () => {
    expect(canonicalStyle({ cards: 'default', nav: 'default' })).toBeUndefined()
    expect(canonicalStyle({ cards: 'flat', nav: 'default' })).toEqual({ cards: 'flat' })
    expect(canonicalStyle(undefined)).toBeUndefined()
  })
  it('normalizes hand-edited design.json values', () => {
    expect(normalizeStyleAxes({ cards: 'flat', buttons: 'wobbly', glitter: 'x' })).toEqual({ cards: 'flat' })
    expect(normalizeStyleAxes('nope')).toBeUndefined()
  })
  it('the input schema rejects unknown values', () => {
    expect(StyleAxesInputSchema.safeParse({ cards: 'wobbly' }).success).toBe(false)
    expect(StyleAxesInputSchema.safeParse({ cards: 'default', nav: 'inverted' }).success).toBe(true)
  })
})

describe('styleAxisHtmlAttributes', () => {
  it('sets non-default axes and REMOVES the rest (preview composition)', () => {
    const attrs = styleAxisHtmlAttributes({ cards: 'flat' })
    expect(attrs['data-c5-cards']).toBe('flat')
    expect(attrs['data-c5-nav']).toBeNull()
    expect(Object.keys(attrs)).toHaveLength(8)
  })
})
```

Append to `lib/editor/theme-edit.test.ts` (import `patchDesignStyle`):

```ts
describe('patchDesignStyle', () => {
  const base = JSON.stringify({ typography: {}, roundness: 'pill' }, null, 2) + '\n'
  it('writes non-default axes and deletes defaults (omit-at-default)', () => {
    const r = patchDesignStyle(base, { cards: 'flat', nav: 'default' })
    expect(r.ok && r.design.style).toEqual({ cards: 'flat' })
    const back = r.ok ? patchDesignStyle(r.next, { cards: 'default' }) : null
    expect(back?.ok && back.design.style).toBeUndefined()
    expect(back?.ok && back.next).toBe(base)
  })
  it('an all-default patch on a design without style is a no-op', () => {
    const r = patchDesignStyle(base, { cards: 'default' })
    expect(r.ok && r.changed).toBe(false)
  })
  it('rejects unknown axes / values and empty patches', () => {
    expect(patchDesignStyle(base, { cards: 'wobbly' } as never).ok).toBe(false)
    expect(patchDesignStyle(base, { glitter: 'x' } as never).ok).toBe(false)
    expect(patchDesignStyle(base, {}).ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `npx vitest run lib/design/style-axes.test.ts lib/editor/theme-edit.test.ts`
Expected: FAIL — missing module / export.

- [ ] **Step 4: Implement the mirror**

Create `lib/design/style-axes.ts`:
- Copy the template's `DEFAULT_AXIS_VALUE`, `STYLE_AXES` (identical key order: `attribute`, `summary`, `values`), `StyleAxis`, `StyleAxisValue`, `StyleAxes`, `STYLE_AXIS_NAMES` and `styleAxesJson` VERBATIM from Task 8 Step 3.
- Add this header:

```ts
// Pure + client-safe. Mirror of the client template's style-axis vocabulary
// (counting-five-client-template src/lib/theme/style-axes.ts), parity-tested
// against its docs/design/style-axes.json (__fixtures__/style-axes.template.json).
// Template T2: design.json `style` → <html data-c5-*> → src/styles/style-axes.css.
```

- Add below the copied block:

```ts
import { z } from 'zod'

export const STYLE_AXIS_ATTRIBUTES: readonly string[] = STYLE_AXIS_NAMES.map((a) => STYLE_AXES[a].attribute)

export const StyleAxesInputSchema = z
  .object({
    sectionRhythm: z.enum(STYLE_AXES.sectionRhythm.values).optional(),
    cards: z.enum(STYLE_AXES.cards.values).optional(),
    buttons: z.enum(STYLE_AXES.buttons.values).optional(),
    heroScale: z.enum(STYLE_AXES.heroScale.values).optional(),
    imageTreatment: z.enum(STYLE_AXES.imageTreatment.values).optional(),
    nav: z.enum(STYLE_AXES.nav.values).optional(),
    footer: z.enum(STYLE_AXES.footer.values).optional(),
    accentUsage: z.enum(STYLE_AXES.accentUsage.values).optional(),
  })
  .strict()

const isAxisValue = (axis: StyleAxis, v: unknown): boolean =>
  typeof v === 'string' && (STYLE_AXES[axis].values as readonly string[]).includes(v)

// Canonical form stored in bundles: non-default values only; undefined when
// every axis is default (absent `style` ≡ all default).
export function canonicalStyle(style: StyleAxes | undefined): StyleAxes | undefined {
  if (!style) return undefined
  const out: Record<string, string> = {}
  for (const axis of STYLE_AXIS_NAMES) {
    const v = style[axis]
    if (v !== undefined && v !== DEFAULT_AXIS_VALUE && isAxisValue(axis, v)) out[axis] = v
  }
  return Object.keys(out).length ? (out as StyleAxes) : undefined
}

// design.json `style` is hand-editable: keep only known axes with valid values.
export function normalizeStyleAxes(value: unknown): StyleAxes | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  const picked: Record<string, string> = {}
  for (const axis of STYLE_AXIS_NAMES) if (isAxisValue(axis, v[axis])) picked[axis] = v[axis] as string
  return canonicalStyle(picked as StyleAxes)
}

// For preview composition: every axis attribute, null = remove (the shell may
// carry the live site's axes, which the previewed design must override).
export function styleAxisHtmlAttributes(style: unknown): Record<string, string | null> {
  const s = normalizeStyleAxes(style) ?? {}
  const out: Record<string, string | null> = {}
  for (const axis of STYLE_AXIS_NAMES) out[STYLE_AXES[axis].attribute] = s[axis] ?? null
  return out
}

// One line per axis for prompts: "cards: flat | outlined | elevated — <summary>".
export function styleAxesSummary(): string {
  return STYLE_AXIS_NAMES.map((a) => {
    const values = (STYLE_AXES[a].values as readonly string[]).filter((v) => v !== DEFAULT_AXIS_VALUE).join(' | ')
    return `- ${a}: ${values} — ${STYLE_AXES[a].summary}`
  }).join('\n')
}
```

(Put the `zod` import at the top of the file with the header.)

- [ ] **Step 5: Type `style` and add `patchDesignStyle`**

In `types/design-json.ts`, after `darkSections?: boolean`:

```ts
  /** Design Studio style axes (template T2, L3+). Omitted at default. Keys/values
   * per lib/design/style-axes.ts; kept loose here so types/ stays dependency-free. */
  style?: Record<string, string>
```

In `lib/editor/theme-edit.ts`, add `import { DEFAULT_AXIS_VALUE, STYLE_AXES, STYLE_AXIS_NAMES, type StyleAxes } from '@/lib/design/style-axes'` and, after `patchDesignFlags`:

```ts
// ---------------------------------------------------------------------------
// Style axes (template T2). Merge-patch: provided axes only; 'default' deletes
// the axis; an empty result deletes `style` — so an untouched design.json
// stays byte-identical (omit-at-default, like the treatment flags).
// ---------------------------------------------------------------------------
export function patchDesignStyle(designJsonText: string, patch: StyleAxes): DesignPatchResult {
  let design: DesignJson
  try {
    design = JSON.parse(designJsonText) as DesignJson
  } catch {
    return { ok: false, reason: 'content/design.json is not valid JSON.' }
  }
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [string, string][]
  if (entries.length === 0) return { ok: false, reason: 'No style changes were provided.' }

  const style: Record<string, string> = { ...(design.style ?? {}) }
  for (const [axis, value] of entries) {
    if (!(STYLE_AXIS_NAMES as string[]).includes(axis)) return { ok: false, reason: `Unknown style axis: ${axis}.` }
    const values = STYLE_AXES[axis as keyof typeof STYLE_AXES].values as readonly string[]
    if (!values.includes(value)) return { ok: false, reason: `${axis} must be one of ${values.join(', ')}.` }
    if (value === DEFAULT_AXIS_VALUE) delete style[axis]
    else style[axis] = value
  }
  const next: DesignJson = { ...design }
  if (Object.keys(style).length) next.style = style
  else delete next.style
  const nextText = serialize(next)
  return { ok: true, next: nextText, design: next, changed: nextText !== designJsonText }
}
```

Check that `lib/design/style-axes.ts` doesn't import `lib/editor/theme-edit.ts` (no cycle).

- [ ] **Step 6: Run the tests and types**

Run: `npx vitest run lib/design/style-axes.test.ts lib/editor && npx tsc --noEmit`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add lib/design/style-axes.ts lib/design/style-axes.test.ts lib/design/__fixtures__/style-axes.template.json types/design-json.ts lib/editor/theme-edit.ts lib/editor/theme-edit.test.ts
git commit -m "feat(design-studio): style-axes mirror + patchDesignStyle (P6b)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: [PLATFORM] `DesignBundle.style` end-to-end — schema, repo files, tiers, preview attributes, sanitizer

**Files:**
- Modify: `lib/design/bundle.ts` (+ `bundle.test.ts`)
- Modify: `lib/design/bundle-files.ts` (+ test)
- Modify: `lib/design/capabilities.ts` (+ test)
- Modify: `lib/design/concept-validate.ts` (+ test)
- Modify: `lib/design/chat-edits.ts` (`sameLevers`)
- Modify: `lib/design/css-targets.ts`
- Modify: `lib/design/composed-theme.ts` (+ test)
- Modify: `lib/theme-preview/compose-srcdoc.ts` (`PREVIEW_HTML_ATTRS`)

**Interfaces:**
- Consumes: Task 20.
- Produces:
  - `DesignBundle.style?: StyleAxes` (canonical);
  - `bundleFromRepoFiles` reads `design.style`;
  - `bundleToRepoFiles` writes it via `patchDesignStyle`;
  - `enforceCapabilities` strips style below L3 (note) and `capabilityViolations` rejects it below L3;
  - `TREATMENT_STATE_ATTRS` and `HTML_STATE_ATTRS` (which now includes the axis attributes);
  - `composedThemeFromFiles().htmlAttributes` includes the 8 axis attributes.

- [ ] **Step 1: Write the failing tests**

- `lib/design/bundle.test.ts`: `parseDesignBundle({ ...VALID, style: { cards: 'flat', nav: 'default' } })` → `bundle.style` equals `{ cards: 'flat' }`. With `{ cards: 'default' }` → `bundle.style` is `undefined`. With `{ cards: 'wobbly' }` → `ok: false`.
- `lib/design/bundle-files.test.ts`:
  - round trip: a design.json with `"style": {"cards": "flat"}` → `bundleFromRepoFiles(...).bundle.style` equals `{ cards: 'flat' }`;
  - `bundleToRepoFiles({ ...b, style: { nav: 'inverted' } }, current, { removeLegacy: true })` → designText has `style: { nav: 'inverted' }` (the `cards` axis is removed: replace semantics);
  - `bundleToRepoFiles({ ...b, style: undefined }, currentWithStyle, …)` → designText has no `style` key;
  - **R1:** for the untouched fixture design, `bundleToRepoFiles(bundleFromRepoFiles(x).bundle, x, { removeLegacy: false }).files.designText === x.designText`.
- `lib/design/capabilities.test.ts` (L2/L3 from `parseTemplateMarker`):
  - `enforceCapabilities({ ...VALID, style: { cards: 'flat' } }, VALID, L2)` → `bundle.style` is `undefined` and the notes contain `'Style axes are not available on this site yet'`;
  - at L3 the style is kept;
  - `capabilityViolations(styled, VALID, L2)` → one violation containing `'Style axes are locked'`;
  - at L3 → `[]`.
- `lib/design/concept-validate.test.ts`: a raw concept with `style: { cards: 'flat' }` at L3 validates with `bundle.style` = `{ cards: 'flat' }`; at L1 it validates with the style dropped and the note present. Replace the old "always strips style" expectation.
- `lib/design/composed-theme.test.ts`: `composedThemeFromFiles({ designText: '{"style":{"cards":"flat"}}', themeCss: '', overridesCss: '' }).htmlAttributes['data-c5-cards']` is `'flat'`, and `['data-c5-nav']` is `null`.
- `lib/theme-preview/compose-srcdoc.test.ts`: `setHtmlAttributes('<html lang="en" data-c5-nav="bordered"><head></head></html>', { 'data-c5-nav': null, 'data-c5-cards': 'flat' })` → `<html lang="en" data-c5-cards="flat">`.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run lib/design lib/theme-preview`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

`lib/design/bundle.ts`: `import { StyleAxesInputSchema, canonicalStyle } from './style-axes'`. After `treatments: …` in `DesignBundleSchema`:

```ts
  // Template style axes (L3+ only — enforceCapabilities strips / apply rejects
  // below). Canonicalized in parseDesignBundle (defaults dropped, undefined
  // when all default). No zod .transform here: it would make the inferred key
  // required and break every DesignBundle literal that omits `style`.
  style: StyleAxesInputSchema.optional(),
```

and in `parseDesignBundle` replace the success line with:

```ts
  if (r.success) {
    const style = canonicalStyle(r.data.style)
    const { style: _raw, ...rest } = r.data
    return { ok: true, bundle: style ? { ...rest, style } : rest }
  }
```

`lib/design/bundle-files.ts`:
- import `patchDesignStyle` from `@/lib/editor/theme-edit`, and `normalizeStyleAxes`, `STYLE_AXIS_NAMES`, `DEFAULT_AXIS_VALUE`, `type StyleAxes` from `./style-axes`;
- in `bundleFromRepoFiles`, add `style: normalizeStyleAxes(design.style)` to the object passed to `parseDesignBundle`;
- in `bundleToRepoFiles`, after `flagged`:

```ts
  // Style axes: the bundle is the WHOLE design, so write every axis (absent =
  // default → deleted). An all-default bundle on a style-less design.json is a
  // no-op, keeping untouched files byte-identical.
  const fullStyle = Object.fromEntries(STYLE_AXIS_NAMES.map((a) => [a, bundle.style?.[a] ?? DEFAULT_AXIS_VALUE])) as StyleAxes
  const styled = patchDesignStyle(flagged.next, fullStyle)
  if (!styled.ok) return { ok: false, errors: [styled.reason] }
```

- then use `styled.next` / `styled.design` wherever `flagged.next` / `flagged.design` were used below: the `designText`, `generateThemeCss(nextBrand, styled.design)`, and the fonts module's `styled.design.typography`.

`lib/design/capabilities.ts`: import `styleAxesUnlocked` (already defined there). Remove `hasStyleField` and its test. Add:

```ts
const STYLE_LOCK_NOTE = 'Style axes are not available on this site yet — the concept’s style settings were dropped.'
const STYLE_LOCK_VIOLATION = 'Style axes are locked on this site (template below L3) — this design sets style presets.'
const sameStyle = (a: DesignBundle['style'], b: DesignBundle['style']): boolean => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})
```

Rewrite `enforceCapabilities` / `capabilityViolations` to handle both levers:

```ts
export function enforceCapabilities(bundle: DesignBundle, current: DesignBundle, caps: DesignCapabilities): { bundle: DesignBundle; notes: string[] } {
  let out = bundle
  const notes: string[] = []
  if (!fontsUnlocked(caps) && !sameTypography(out.typography, current.typography)) {
    out = { ...out, typography: { ...current.typography } }
    notes.push(FONT_LOCK_NOTE)
  }
  if (!styleAxesUnlocked(caps) && out.style !== undefined) {
    const { style: _dropped, ...rest } = out
    out = rest
    notes.push(STYLE_LOCK_NOTE)
  }
  return { bundle: out, notes }
}

export function capabilityViolations(bundle: DesignBundle, current: DesignBundle, caps: DesignCapabilities): string[] {
  const v: string[] = []
  if (!fontsUnlocked(caps) && !sameTypography(bundle.typography, current.typography)) v.push(FONT_LOCK_VIOLATION)
  if (!styleAxesUnlocked(caps) && !sameStyle(bundle.style, current.style)) v.push(STYLE_LOCK_VIOLATION)
  return v
}
```

Update the header comment: "`style` (L3+) is stripped by the generator and rejected on apply below L3."

`lib/design/concept-validate.ts`:
- delete `STYLE_NOTE`, the `hasStyleField` import, and the lines `if (hasStyleField(raw)) notes.push(STYLE_NOTE)` and `delete candidate.style` (style now parses and is tier-enforced by `enforceCapabilities`);
- update header step 1 to `force schemaVersion/meta` and step 3 to `capability tier (fonts below L2 / style below L3 → current, with a note)`.

`lib/design/chat-edits.ts`: in `levers`, add `s: b.style ?? {}`:

```ts
const levers = (b: DesignBundle) => JSON.stringify({ p: b.palette, t: b.typography, k: b.tokens, r: b.treatments, s: b.style ?? {}, c: b.css })
```

`lib/design/css-targets.ts`:

```ts
import { STYLE_AXIS_ATTRIBUTES } from './style-axes'

// <html> state attributes the template sets from design.json. CSS may key off
// them (html[data-headline="serif"] [data-block="hero"] …). The treatment pair
// is what the brief's byte-stable CSS rules list; the style-axis attributes
// (T2) are advertised in the tier-dependent levers section instead.
export const TREATMENT_STATE_ATTRS: readonly string[] = ['data-headline', 'data-eyebrow']
export const HTML_STATE_ATTRS: readonly string[] = [...TREATMENT_STATE_ATTRS, ...STYLE_AXIS_ATTRIBUTES]
```

In `lib/design/brief/contract.ts`, change `CSS_RULES_SECTION`'s `HTML_STATE_ATTRS` reference to `TREATMENT_STATE_ATTRS` (and the import). Its text stays byte-identical, which the existing brief prefix-stability test proves.

`lib/design/composed-theme.ts`: import `styleAxisHtmlAttributes` from `./style-axes`, and extend `htmlAttributes`:

```ts
    htmlAttributes: {
      'data-headline': design.headlineStyle ?? 'sans',
      'data-eyebrow': design.eyebrowStyle ?? 'standard',
      ...styleAxisHtmlAttributes(design.style),
    },
```

`lib/theme-preview/compose-srcdoc.ts`:

```ts
import { STYLE_AXIS_ATTRIBUTES } from '@/lib/design/style-axes'

export const PREVIEW_HTML_ATTRS: readonly string[] = ['data-headline', 'data-eyebrow', ...STYLE_AXIS_ATTRIBUTES]
```

(Type change from a tuple to `readonly string[]`: fix any `(typeof PREVIEW_HTML_ATTRS)[number]` user tsc reports by typing it as `string`.)

- [ ] **Step 4: Run everything**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: green, including the unchanged `theme.css.golden` test and the brief byte-stability test.

- [ ] **Step 5: Commit**

```bash
git add lib/design/bundle.ts lib/design/bundle.test.ts lib/design/bundle-files.ts lib/design/bundle-files.test.ts lib/design/capabilities.ts lib/design/capabilities.test.ts \
  lib/design/concept-validate.ts lib/design/concept-validate.test.ts lib/design/chat-edits.ts lib/design/css-targets.ts lib/design/brief/contract.ts \
  lib/design/composed-theme.ts lib/design/composed-theme.test.ts lib/theme-preview/compose-srcdoc.ts lib/theme-preview/compose-srcdoc.test.ts
git commit -m "feat(design-studio): DesignBundle.style — L3 style axes end-to-end (P6b)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 22: [PLATFORM] Axes in the concept brief

**Files:**
- Modify: `lib/design/brief/contract.ts`, `lib/design/brief/index.ts`
- Modify: `lib/design/brief/brief.test.ts`

**Interfaces:**
- Consumes: `styleAxesUnlocked`, `styleAxesSummary`, `STYLE_AXES`.
- Produces:
  - `buildContract(caps)` differs per `(fontsUnlocked, styleAxesUnlocked)` tier;
  - `buildStaticPrefix` caches per `tierKey(caps)` (`'f-'`, `'fs'`, `'--'`);
  - the output format includes `"style"` only at L3+.

- [ ] **Step 1: Write the failing tests**

Add to `lib/design/brief/brief.test.ts`, with `L2`/`L3`/`L4` from `parseTemplateMarker`:

```ts
describe('style axes in the brief', () => {
  it('below L3 forbids a style field', () => {
    const p = buildStaticPrefix(L2)
    expect(p).toContain('Never emit a "style" field')
    expect(p).not.toContain('sectionRhythm')
  })
  it('at L3+ lists every axis with its values and how CSS may key off it', () => {
    const p = buildStaticPrefix(L3)
    expect(p).not.toContain('Never emit a "style" field')
    for (const a of ['sectionRhythm', 'cards', 'buttons', 'heroScale', 'imageTreatment', 'nav', 'footer', 'accentUsage']) expect(p).toContain(`- ${a}: `)
    expect(p).toContain('html[data-c5-cards="flat"]')
    expect(p).toContain('"style":{')
  })
  it('stays byte-stable per tier and L3 ≡ L4 for the prefix', () => {
    expect(buildStaticPrefix(L3)).toBe(buildStaticPrefix(L3))
    expect(buildStaticPrefix(L4)).toBe(buildStaticPrefix(L3))
    expect(buildStaticPrefix(L2)).not.toBe(buildStaticPrefix(L3))
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run lib/design/brief`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `lib/design/brief/contract.ts`:
- update the header: `Byte-stable per capability tier: it may depend on caps ONLY through fontsUnlocked() and styleAxesUnlocked().`;
- import `styleAxesUnlocked` from `../capabilities` and `styleAxesSummary` from `../style-axes`;
- replace the last line of `leversSection` (`- Never emit a "style" field …`) with `${styleLever(caps)}`, and add:

```ts
function styleLever(caps: DesignCapabilities): string {
  if (!styleAxesUnlocked(caps)) return '- Never emit a "style" field (style axes are not available on this site).'
  return `- style (optional): template style presets — { <axis>: <value> }; omit an axis (or use "default") to keep the default look. Prefer a preset over hand CSS for the same effect. Axes:
${styleAxesSummary()}
  When an axis is set, css.blocks.<id> may also be prefixed by it, e.g. html[data-c5-cards="flat"] [data-block="service-cards"] … (attribute = data-c5-<kebab axis>).`
}
```

- replace the `OUTPUT_FORMAT` constant with a function:

```ts
function outputFormat(caps: DesignCapabilities): string {
  const style = styleAxesUnlocked(caps) ? ',"style":{"cards":"…"}' : ''
  return `OUTPUT FORMAT
Return ONLY this JSON (no prose, no markdown fences):
{"concepts":[{"name":"…","tagline":"…","rationale":"…","moves":["…"],"palette":{"primary":"#…","secondary":"#…","complementary":"#…","action":"#…","nearBlack":"#…","nearWhite":"#…"},"typography":{"headingFont":"…","bodyFont":"…","accentFont":"…"},"tokens":{"roundness":"…","density":"…","visualFeel":"…","spacing":{"xs":"…","sm":"…","md":"…","lg":"…","xl":"…","2xl":"…"},"radius":{"none":"…","sm":"…","md":"…","lg":"…","pill":"…"}},"treatments":{"headlineStyle":"…","eyebrowStyle":"…","darkSections":false}${style},"css":{"global":"…","blocks":{"hero":"…"}}}]}
name ≤ 60 chars, tagline ≤ 160, rationale ≤ 2000, at most 6 moves of ≤ 200 chars each.`
}
```

  and use `outputFormat(caps)` in `buildContract`. The L1/L2 text must stay byte-identical to the old constant: verify with the existing prefix test.

In `lib/design/brief/index.ts`:
- import `styleAxesUnlocked`;
- replace the cache key line in `buildStaticPrefix` with:

```ts
  const key = `${fontsUnlocked(caps) ? 'f' : '-'}${styleAxesUnlocked(caps) ? 's' : '-'}`
```

- in `currentDesignJson`, include style when present:

```ts
function currentDesignJson(current: DesignBundle): string {
  const { palette, typography, tokens, treatments, style } = current
  return JSON.stringify({ palette, typography, tokens, treatments, ...(style ? { style } : {}) })
}
```

  (For a style-less current design the string is unchanged.)
- in `conceptSummaryLines`, append ` · style ${JSON.stringify(bundle.style)}` to each line when `bundle.style` is set, so the next concept can differ on presets.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/design && npx tsc --noEmit`
Expected: green (the existing L1/L2 byte-stability tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/design/brief/contract.ts lib/design/brief/index.ts lib/design/brief/brief.test.ts
git commit -m "feat(design-studio): style axes in the concept brief at L3+ (P6b)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: [PLATFORM] `set_style_axes` chat tool

**Files:**
- Modify: `lib/design/chat-edits.ts` (+ test)
- Modify: `lib/design/chat-workspace.ts` (+ test)
- Modify: `lib/design/chat-tools.ts` (+ test)
- Modify: `lib/design/chat-ui.ts` (+ test)
- Modify: `lib/design/brief/chat-prompt.ts` (+ test)

**Interfaces:**
- Consumes: `StyleAxesInputSchema`, `canonicalStyle`, `styleAxesSummary` (Task 20); `styleAxesUnlocked`.
- Produces:
  - `ChatEdit | { kind: 'style'; patch: StyleAxes }`;
  - `STYLE_LOCKED_TOOL_ERROR`;
  - the `set_style_axes` tool;
  - the chat-UI label `'Style presets'`.

- [ ] **Step 1: Write the failing tests**

- `lib/design/chat-edits.test.ts`:
  - `applyChatEdit(VALID, { kind: 'style', patch: { cards: 'flat' } }).style` equals `{ cards: 'flat' }`;
  - then `{ kind: 'style', patch: { cards: 'default' } }` gives `style` undefined;
  - `describeChatEdit({ kind: 'style', patch: { cards: 'flat', nav: 'bordered' } })` is `'style (cards, nav)'`.
- `lib/design/chat-workspace.test.ts`:
  - at L2, `ws.apply({ kind: 'style', patch: { cards: 'flat' } })` → `{ ok: false, error: STYLE_LOCKED_TOOL_ERROR }` and the revision is unchanged;
  - at L3 → `{ ok: true, changed: true }`, and `ws.renderedFiles()` designText contains `"cards": "flat"`.
- `lib/design/chat-tools.test.ts`: the tool set contains `set_style_axes`. Executing it with `{ nav: 'inverted' }` at L3 stages the change (following the file's existing `set_treatments` test pattern).
- `lib/design/chat-ui.test.ts`: a `set_style_axes` tool part maps to label `'Style presets'`.
- `lib/design/brief/chat-prompt.test.ts`:
  - `buildChatSystemStatic({ …, caps: L3 })` contains `'set_style_axes('` and `'STYLE AXES: unlocked'`, and no longer contains `'Style presets for cards, buttons and sections are not available yet.'`;
  - at L2 it contains `'STYLE AXES: LOCKED'`.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run lib/design/chat-edits.test.ts lib/design/chat-workspace.test.ts lib/design/chat-tools.test.ts lib/design/chat-ui.test.ts lib/design/brief/chat-prompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/design/chat-edits.ts`:
- import `canonicalStyle` and `type StyleAxes` from `./style-axes`;
- add `| { kind: 'style'; patch: StyleAxes }` to `ChatEdit`;
- in `applyChatEdit` add:

```ts
    case 'style':
      return { ...b, style: canonicalStyle({ ...(b.style ?? {}), ...defined(e.patch) }) }
```

- in `describeChatEdit` add `case 'style':` to the palette/fonts/treatments group.

`lib/design/chat-workspace.ts`:
- import `styleAxesUnlocked`;
- add the constant

```ts
export const STYLE_LOCKED_TOOL_ERROR =
  'Style presets are locked on this site (its template is below L3) — nothing was changed. Use tokens, treatments and block CSS instead.'
```

- in `apply`, after the fonts check, add `if (edit.kind === 'style' && !styleAxesUnlocked(this.caps)) return { ok: false, error: STYLE_LOCKED_TOOL_ERROR }`.

`lib/design/chat-tools.ts`:
- update the header's last sentence to `set_style_axes is refused below L3 by the workspace.`;
- import `StyleAxesInputSchema`;
- add after `set_treatments`:

```ts
    set_style_axes: tool({
      description: 'Stage template style presets (section rhythm, cards, buttons, hero scale, images, nav, footer, accent). "default" restores an axis. Refused on sites whose style axes are locked.',
      inputSchema: StyleAxesInputSchema,
      execute: async (patch) => edit({ kind: 'style', patch }),
    }),
```

`lib/design/chat-ui.ts`: add `set_style_axes: 'Style presets',` to `EDIT_LABELS`.

`lib/design/brief/chat-prompt.ts`:
- in `TOOLS`, replace the last line (`- Style presets for cards, buttons and sections are not available yet.`) with:

```
- set_style_axes({ sectionRhythm?, cards?, buttons?, heroScale?, imageTreatment?, nav?, footer?, accentUsage? }) — template style presets (see the STYLE AXES line); "default" restores an axis. Prefer a preset over block CSS for the same effect.
```

- add below `fontsLine`:

```ts
function styleLine(caps: DesignCapabilities): string {
  return styleAxesUnlocked(caps)
    ? `STYLE AXES: unlocked —\n${styleAxesSummary()}`
    : 'STYLE AXES: LOCKED on this site (its template predates style presets). set_style_axes will be refused — use tokens, treatments and block CSS instead.'
}
```

- include `styleLine(args.caps)` directly after `fontsLine(args.caps)` in `buildChatSystemStatic`, and import `styleAxesUnlocked` / `styleAxesSummary`.

Note: the static chat block is per session + tier, so the prompt cache is unaffected within a tier.

- [ ] **Step 4: Run everything**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add lib/design/chat-edits.ts lib/design/chat-edits.test.ts lib/design/chat-workspace.ts lib/design/chat-workspace.test.ts lib/design/chat-tools.ts \
  lib/design/chat-tools.test.ts lib/design/chat-ui.ts lib/design/chat-ui.test.ts lib/design/brief/chat-prompt.ts lib/design/brief/chat-prompt.test.ts
git commit -m "feat(design-studio): set_style_axes chat tool (P6b)

Resolves the P5 deviation 'no style_axes tool until P6b'.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: [PLATFORM] Specimen in the page picker (L4)

**Files:**
- Modify: `lib/design/pages.ts`, `lib/design/pages.test.ts`
- Modify: `app/api/edit/[id]/design/pages/route.ts` (+ a test if the route has one)
- Modify: `components/design-studio/PagePicker.tsx`

**Interfaces:**
- Consumes: `readEffectiveCapabilities`, `specimenUnlocked` (Task 16).
- Produces:
  - `SPECIMEN_PATH = '/design-specimen'`;
  - `PreviewPage['key']` gains `'specimen'`;
  - `pickRepresentativePages(contentPaths: string[], opts?: { specimen?: boolean })`.

- [ ] **Step 1: Write the failing test**

Add to `lib/design/pages.test.ts`:

```ts
it('offers the block specimen last when the site supports it', () => {
  const paths = ['content/pages/home.md', 'content/pages/contact.md']
  expect(pickRepresentativePages(paths).picks.map((p) => p.key)).not.toContain('specimen')
  const { picks, pages } = pickRepresentativePages(paths, { specimen: true })
  expect(picks.at(-1)).toEqual({ key: 'specimen', path: '/design-specimen' })
  expect(pages).not.toContain('/design-specimen')
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/design/pages.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/design/pages.ts`:
- update the header: add `…and, on L4 sites, the template's /design-specimen (every block once).`;
- then:

```ts
export const SPECIMEN_PATH = '/design-specimen'
export type PreviewPage = { key: 'home' | 'service' | 'about' | 'contact' | 'specimen'; path: string }

export function pickRepresentativePages(contentPaths: string[], opts: { specimen?: boolean } = {}): { picks: PreviewPage[]; pages: string[] } {
```

and before `return { picks, pages }` add `if (opts.specimen) picks.push({ key: 'specimen', path: SPECIMEN_PATH })`.

`app/api/edit/[id]/design/pages/route.ts`:
- import `readEffectiveCapabilities` and `specimenUnlocked`;
- inside the try:

```ts
    const [tree, caps] = await Promise.all([
      listTree(ctx.githubRepo, DRAFT_BRANCH, 'content/pages/'),
      readEffectiveCapabilities({ githubRepo: ctx.githubRepo, jobId: ctx.jobId }),
    ])
    const paths = tree.filter((e) => e.type === 'blob').map((e) => e.path)
    return NextResponse.json(pickRepresentativePages(paths, { specimen: specimenUnlocked(caps.effective) }))
```

- update the comment: `Read from DRAFT; the specimen pick needs the effective (draft ∩ live shell) tier, since the page must exist on the deployed site the renderer loads.`

`components/design-studio/PagePicker.tsx`: extend `PICK_LABELS` with `specimen: 'Block specimen (every block)'`.

- [ ] **Step 4: Run everything**

Run: `npx tsc --noEmit && npm test && npm run lint && npm run build`
Then the three CLAUDE.md greps.
Expected: green; greps empty.

- [ ] **Step 5: Commit**

```bash
git add lib/design/pages.ts lib/design/pages.test.ts "app/api/edit/[id]/design/pages" components/design-studio/PagePicker.tsx
git commit -m "feat(design-studio): block specimen in the page picker on L4 sites (P6b)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: [PLATFORM] Record the T1/T2/P6 decisions in the spec + final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-09-24-design-studio-design.md`

- [ ] **Step 1: Update the spec**

Under `### T1 — Template: marker + fonts module + accentFont`, add:

```markdown
- **Accepted deviations (recorded 2026-09-26, T1 + P6a):**
  - **"Byte-identical" = identical pixels.** next/font class hashes change when the calls move into `fonts.generated.ts`. R1 is enforced by a local Playwright pixel baseline (captured on `a540d1e`), a vitest pin of the default module text, an untouched `theme.css`, and no default `data-c5-*` attributes.
  - **The fonts module is a committed artifact** (like `theme.css`). There is no prebuild regeneration, and template CI's `generate-fonts --check` guards drift. The platform regenerates it on EVERY theme write to an L2+ draft, so a stale module (e.g. a fleet-seeded default) changes the live fonts on the next publish. The Versions panel warns (`fontsModuleStale`).
  - **Two capability reads.** Gates use draft ∩ live-shell meta. File-contract decisions (write/guard the module, `applied_blobs`, drift paths) use the draft marker. A shell without the meta = L1. An unreachable shell = draft tier, flagged `unverified`. Verified reads are cached 60 s.
  - **`applied_blobs` = four theme files, plus `src/app/fonts.generated.ts` on L2+ drafts.** Drift compares the module only once a version recorded it, so pre-P6a versions don't show a false drift.
  - **Preview font vars are `!important`**, so a chosen body font beats the template's inline `--font-body-loaded` alias.
  - **Deliverable push does not yet write `fonts.generated.ts`.** New L2 sites start on the default module until their first theme write (flagged stale). See Open items.
```

Under `### T2 — Template: style axes + specimen`, add:

```markdown
- **Accepted deviations (recorded 2026-09-26, T2 + P6b):**
  - **Hooks:** besides `data-c5="button"` and the headline accent span (`data-c5="headline-accent"`, on all four accent spans), two more inert hooks: `data-c5="media-grade"` (FramedMedia overlay) and `data-c5-spacing` (Section padding). The accent's inline colour is kept, so accent-usage presets use `!important` in template CSS.
  - **Attributes are prefixed** `html[data-c5-<axis>]`. v1 values: sectionRhythm compact|generous; cards flat|outlined|elevated; buttons pill|sharp|bold; heroScale compact|dramatic; imageTreatment natural|mono|rounded; nav bordered|inverted; footer light|brand; accentUsage subtle|plain|underline.
  - **`DesignBundle.style` is canonical** (defaults dropped; absent = all default). Apply writes the whole axis set, deleting `design.json.style` when all default. Below L3 it is stripped by the generator and rejected on apply.
  - **The brief's CSS rules stay byte-stable.** Axis attributes are advertised in the tier-dependent levers section only. The sanitizer accepts them at every tier (they match nothing on older templates).
  - **Specimen robots:** `noindex` meta + `X-Robots-Tag`. It is deliberately NOT disallowed in robots.txt (that would hide the noindex).
```

Delete the now-resolved sentences:
- the P3 bullet "Capabilities come from the draft marker only …": replace with `Resolved in P6a: capabilities are draft ∩ live-shell meta.`;
- the P5 bullet "No `style_axes` tool until P6b …": replace with `Resolved in P6b: set_style_axes (refused below L3).`

- [ ] **Step 2: Final verification**

Run: `npx tsc --noEmit && npm test && npm run lint && npm run build`
Then the three CLAUDE.md greps.
Expected: green; greps empty.

- [ ] **Step 3: Live E2E checklist (on a test client after T3 puts a T2 template on its draft AND main)**

1. The Studio state shows L4 (runs snapshot `capabilities.level === 4`, `shell: 'verified'`).
2. Chat: "use Lora for headings" → commit → the Changes panel shows `design.json` + `src/app/fonts.generated.ts`, and the draft build succeeds.
3. Chat: "make the cards flat and the nav inverted" → the preview shows it → commit → `design.json.style` is set.
4. Pick "Block specimen" in the page picker → run 2 concepts → renders show every block.
5. On an L1 client: `set_fonts` / `set_style_axes` are refused; no fonts module path in `applied_blobs`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-24-design-studio-design.md
git commit -m "docs(design-studio): record T1/T2/P6 decisions in the spec

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Open items (not in this plan)

- **T3 rollout.** The fleet sync must:
  - treat `src/app/fonts.generated.ts` as seed-if-absent (the template DEFAULT file, verbatim);
  - never overwrite `content/design.json` or `content/design-overrides.css`;
  - write `c5-template.json` last;
  - show the reconciled roster first.
- **Deliverable push.** `pushAssembledDeliverable` / the package assembler writes `design.json` but neither `theme.css` (the known gap) nor `fonts.generated.ts`. Once T3 seeds L2 templates, a follow-up should derive both at package time.
- **Controls tab UI.** Theme Studio Controls could expose the style axes via `patchDesignStyle` (the theme PATCH route doesn't accept `style` yet).
