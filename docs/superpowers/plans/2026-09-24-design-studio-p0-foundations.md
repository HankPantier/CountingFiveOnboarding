# Design Studio P0 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the non-UI foundations the Design Studio builds on:
- the design model constants and pricing;
- a strict CSS sanitizer for `design-overrides.css`;
- a versionable `DesignBundle` with pure bundle ⇄ repo-file conversion;
- an atomic apply-to-draft helper plus an extracted MBP sync;
- a fix that lets Theme Studio's preview actually show the treatment flags.

**Architecture:**
- New `lib/design/` module:
  - Pure, client-safe pieces: `css-targets.ts`, `bundle.ts` (zod).
  - Server-only pieces: `css-sanitizer.ts` (postcss + postcss-selector-parser + lightningcss, a native module), `bundle-files.ts`, `apply-bundle.ts`, `sync-mbp-theme.ts`.
- Existing Theme Studio code changes:
  - The theme chat's `set_block_override` runs through the new sanitizer.
  - The theme PATCH route uses the extracted MBP sync.
  - The preview gets an `htmlAttributes` hook so treatments render.
- No new routes, tables or UI.

**Tech Stack:** Next.js 16, TypeScript strict, vitest, zod 4, postcss 8, postcss-selector-parser 7, lightningcss 1.32, Supabase JS, GitHub App (Octokit via `lib/github/repo-files.ts`).

**Spec:** `docs/superpowers/specs/2026-09-24-design-studio-design.md` (read §Architecture, §Safety and validation, §Phased delivery → P0).

## Global Constraints

- **Access:**
  - Admin-only everywhere.
  - No new routes in P0, and existing gates are unchanged (`resolveEditContext` + `ctx.user.isAdmin`).
- **Model ids:**
  - Never hardcode a model id outside `lib/content/generation-tuning.ts`.
  - Every model id needs a `PRICING` entry in `lib/content/token-pricing.ts`.
- **Logging and errors:**
  - Never write `console.log` in `app/` or `lib/`. Use `console.warn` / `console.error`.
  - 5xx responses use `internalError(context, err, publicMessage)` from `lib/api/errors.ts`.
  - `StaleShaError` maps to 409 `{ error, stale: true, path }`.
- **Types and data:**
  - No `as any`.
  - JSONB writes use `asJson()`.
  - `schema_data` read-modify-write goes through `updateSessionWithCas()`.
- **JSON files:**
  - Written as `JSON.stringify(obj, null, 2) + '\n'`.
  - Treatment flags are omitted at their default (use `patchDesignFlags`).
- **CSS and colour:**
  - Colours are `#rrggbb` only, lowercased.
  - Fonts must be in `CURATED_FONTS`, and `googleFontsUrl` is always rebuilt server-side with `gfUrl`.
  - `lightningcss` is a native module. Never import `lib/design/css-sanitizer.ts` (or anything that imports it) from a `'use client'` file.
- **Checks:**
  - After each task: `npx tsc --noEmit` must be clean.
  - Before each commit, `grep -rn "console\.log" ./app ./lib --include="*.ts" --include="*.tsx" --exclude="*.test.ts" --exclude="*.test.tsx"` must return zero matches.
- **Commits:** end every commit message with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Branch:** `feat/design-studio` (already exists; the spec is committed there).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `lib/content/generation-tuning.ts` | modify | `DESIGN_MODEL`, `DESIGN_AB_CHALLENGER_MODEL` |
| `lib/content/token-pricing.ts` | modify | Fable 5.1 price; `design_concept` / `design_critique` / `design_chat` stages |
| `lib/content/token-pricing.test.ts` | modify | Price assertions for the new constants |
| `lib/theme-preview/compose-srcdoc.ts` | modify | `setHtmlAttributes()` + `htmlAttributes` option |
| `lib/theme-preview/preview.test.ts` | modify | Tests for the above |
| `components/editor/ThemePreview.tsx` | modify | Pass treatment attributes to the preview |
| `components/editor/ThemeControls.tsx` | modify | Update the "treatments don't preview" notice |
| `lib/design/css-targets.ts` | create | `CHROME_COMPONENTS`, `CSS_TARGETS`, `HTML_STATE_ATTRS` (pure) |
| `lib/design/css-sanitizer.ts` | create | `sanitizeDesignCss()` (server-only) |
| `lib/design/css-sanitizer.test.ts` | create | Sanitizer tests |
| `app/api/edit/[id]/theme/chat/route.ts` | modify | `set_block_override` goes through the sanitizer |
| `lib/design/bundle.ts` | create | `DesignBundleSchema`, `DesignBundle`, `parseDesignBundle()` (client-safe) |
| `lib/design/bundle.test.ts` | create | |
| `lib/design/bundle-files.ts` | create | Region helpers, `bundleFromRepoFiles()`, `bundleToRepoFiles()` (server-only) |
| `lib/design/bundle-files.test.ts` | create | |
| `lib/design/sync-mbp-theme.ts` | create | Summaries + `syncMbpTheme()` (extracted from the theme route) |
| `lib/design/sync-mbp-theme.test.ts` | create | |
| `app/api/edit/[id]/theme/route.ts` | modify | Use `syncMbpTheme()` |
| `lib/design/apply-bundle.ts` | create | `applyBundleToDraft()` |
| `lib/design/apply-bundle.test.ts` | create | Mocks `@/lib/github/repo-files` |
| `package.json` | modify | Direct deps: `postcss`, `postcss-selector-parser`, `lightningcss` |
| `lib/editor/theme-edit.ts` | modify | Export `LENGTH_RE` and `HEX_RE` |

**Deviation from the spec text:** the spec says to "refactor theme route and chat onto" the new units. In P0 that is limited to the two changes that have real value: the MBP-sync extraction and sanitizing the chat's block CSS. The PATCH route keeps using its per-field patch helpers, because rewriting it onto bundles would add risk with no behaviour gain.

---

### Task 1: Design model constants, Fable pricing, token stages

**Files:**
- Modify: `lib/content/generation-tuning.ts` (after `CRITIC_MODEL`, around line 18)
- Modify: `lib/content/token-pricing.ts` (the `TokenStage` union, lines 9–31; the `PRICING` map, lines 53–64)
- Test: `lib/content/token-pricing.test.ts`

**Interfaces:**
- Produces: `DESIGN_MODEL: 'claude-opus-5-5'` and `DESIGN_AB_CHALLENGER_MODEL: 'claude-fable-5-1'` exported from `lib/content/generation-tuning.ts`. `TokenStage` gains `'design_concept' | 'design_critique' | 'design_chat'`.

- [ ] **Step 1: Write the failing test.** Append to `lib/content/token-pricing.test.ts`, and add `DESIGN_MODEL, DESIGN_AB_CHALLENGER_MODEL` to its existing import from `./generation-tuning`:

```ts
describe('design studio model pricing', () => {
  it('prices DESIGN_MODEL (Opus 5.5) at $4/$20', () => {
    expect(DESIGN_MODEL).toBe('claude-opus-5-5')
    expect(estimateCostUsd(DESIGN_MODEL, M, M)).toBeCloseTo(24)
  })

  it('prices the A/B challenger (Fable 5.1) at 5x Sonnet 5 ($10/$50)', () => {
    expect(DESIGN_AB_CHALLENGER_MODEL).toBe('claude-fable-5-1')
    expect(estimateCostUsd(DESIGN_AB_CHALLENGER_MODEL, M, M)).toBeCloseTo(60)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails.**
Run: `npx vitest run lib/content/token-pricing.test.ts`
Expected: FAIL, because `DESIGN_MODEL` is not exported.

- [ ] **Step 3: Implement.** In `lib/content/generation-tuning.ts`, directly after the `CRITIC_MODEL` line, add:

```ts
// Design Studio concept generation + vision self-critique (admin-only, a few
// runs per client). Taste and visual judgement matter more than cost here, so
// it uses the strongest everyday tier. Opus 5.5 always thinks and rejects forced
// toolChoice — use generateText → extractJson → zod (see draft-critic.ts).
export const DESIGN_MODEL = 'claude-opus-5-5'

// Only for scripts/compare-design-models.ts (A/B vs DESIGN_MODEL). Not used by
// any route — the tier map keeps Fable out of production paths until the A/B
// says otherwise.
export const DESIGN_AB_CHALLENGER_MODEL = 'claude-fable-5-1'
```

In `lib/content/token-pricing.ts`, extend the union by replacing `  | 'critic'` with:

```ts
  | 'critic'
  | 'design_concept'
  | 'design_critique'
  | 'design_chat'
```

Then add this entry to `PRICING` after the `'claude-opus-5-5'` line:

```ts
  // Fable 5.1 — 5x Sonnet 5 per the CLAUDE.md tier map. Only the design-model
  // A/B script calls it. Verify against Anthropic's price list before relying
  // on its recorded cost.
  'claude-fable-5-1': { input: 10, output: 50 },
```

- [ ] **Step 4: Run the tests and the type check.**
Run: `npx vitest run lib/content/token-pricing.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit.**

```bash
git add lib/content/generation-tuning.ts lib/content/token-pricing.ts lib/content/token-pricing.test.ts
git commit -m "feat(design-studio): DESIGN_MODEL constants, Fable 5.1 pricing, design token stages

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Treatment attributes in the Theme Studio preview

The preview shell is the deployed page, so `<html data-headline/data-eyebrow>` always reflects what is *live*. Toggling a treatment in Theme Studio therefore never changed the preview. This task rewrites those attributes on the composed document.

**Files:**
- Modify: `lib/theme-preview/compose-srcdoc.ts`
- Modify: `components/editor/ThemePreview.tsx` (the `useMemo` that calls `composePreviewSrcDoc`)
- Modify: `components/editor/ThemeControls.tsx:251-253` (the notice text)
- Test: `lib/theme-preview/preview.test.ts`

**Interfaces:**
- Produces:
  - `PREVIEW_HTML_ATTRS: readonly ['data-headline', 'data-eyebrow']`
  - `setHtmlAttributes(html: string, attrs: Record<string, string | null>): string`
  - `composePreviewSrcDoc({ …, htmlAttributes?: Record<string, string | null> })`
- Later phases (P6b) extend `PREVIEW_HTML_ATTRS` with the style axes.

- [ ] **Step 1: Write the failing tests.** Append to `lib/theme-preview/preview.test.ts`, and add `setHtmlAttributes` to the import from `./compose-srcdoc`:

```ts
describe('setHtmlAttributes', () => {
  const html = '<!doctype html><html lang="en" data-headline="sans" data-eyebrow="standard"><head></head><body></body></html>'

  it('overrides existing treatment attributes on <html>', () => {
    const out = setHtmlAttributes(html, { 'data-headline': 'serif', 'data-eyebrow': 'mono' })
    expect(out).toContain('<html lang="en" data-headline="serif" data-eyebrow="mono">')
    expect(out).not.toContain('data-headline="sans"')
  })

  it('adds an attribute the shell lacks (older template)', () => {
    const out = setHtmlAttributes('<html lang="en"><head></head></html>', { 'data-headline': 'serif' })
    expect(out).toContain('<html lang="en" data-headline="serif">')
  })

  it('removes an attribute when the value is null', () => {
    const out = setHtmlAttributes(html, { 'data-eyebrow': null })
    expect(out).not.toContain('data-eyebrow')
    expect(out).toContain('data-headline="sans"')
  })

  it('ignores keys outside the allowlist', () => {
    const out = setHtmlAttributes(html, { onload: 'alert(1)', 'data-headline': 'serif' })
    expect(out).not.toContain('onload')
    expect(out).toContain('data-headline="serif"')
  })

  it('escapes values so they cannot break out of the attribute', () => {
    const out = setHtmlAttributes(html, { 'data-headline': '"><script>x</script>' })
    expect(out).not.toContain('<script>')
    expect(out).toContain('data-headline="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"')
  })

  it('only touches the first <html> tag', () => {
    const doc = `${html}<!-- <html data-headline="sans"> -->`
    const out = setHtmlAttributes(doc, { 'data-headline': 'serif' })
    expect(out.endsWith('<!-- <html data-headline="sans"> -->')).toBe(true)
  })
})

describe('composePreviewSrcDoc htmlAttributes', () => {
  it('applies treatment attributes to the composed document', () => {
    const shellHtml = `<html data-headline="sans"><head>${THEME_SLOT}</head><body></body></html>`
    const out = composePreviewSrcDoc({
      shellHtml,
      themeCss: '',
      overridesCss: '',
      htmlAttributes: { 'data-headline': 'serif' },
    })
    expect(out).toContain('<html data-headline="serif">')
  })
})
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `npx vitest run lib/theme-preview/preview.test.ts`
Expected: FAIL, because `setHtmlAttributes` is not exported.

- [ ] **Step 3: Implement.** In `lib/theme-preview/compose-srcdoc.ts`, add after the `attrSafe` function:

```ts
// <html> attributes the preview may rewrite. The deployed shell carries the LIVE
// treatment attributes, so the preview has to overwrite them with the pending
// draft values or treatment toggles would never show. Allowlisted so a caller
// can never add event handlers or other attributes to the frame's root.
export const PREVIEW_HTML_ATTRS = ['data-headline', 'data-eyebrow'] as const

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Set (string) or remove (null) allowlisted attributes on the FIRST <html> tag.
export function setHtmlAttributes(html: string, attrs: Record<string, string | null>): string {
  const match = /<html\b[^>]*>/i.exec(html)
  if (!match) return html
  let tag = match[0]
  for (const [key, value] of Object.entries(attrs)) {
    if (!(PREVIEW_HTML_ATTRS as readonly string[]).includes(key)) continue
    // Drop any existing occurrence (double-, single- or un-quoted).
    tag = tag.replace(new RegExp(`\\s${key}(=("[^"]*"|'[^']*'|[^\\s>]*))?(?=[\\s>])`, 'i'), '')
    if (value !== null) tag = tag.replace(/>$/, ` ${key}="${escapeAttr(value)}">`)
  }
  return html.slice(0, match.index) + tag + html.slice(match.index + match[0].length)
}
```

Then change `composePreviewSrcDoc` to take and apply the option:

```ts
export function composePreviewSrcDoc(args: {
  shellHtml: string
  themeCss: string
  overridesCss: string
  typography?: PreviewTypography
  htmlAttributes?: Record<string, string | null>
}): string {
  const { link, vars } = fontHead(args.typography)
  const style = `${link}<style>${vars}\n${cssSafe(args.themeCss)}\n${cssSafe(args.overridesCss)}</style>`
  const shellHtml = args.htmlAttributes ? setHtmlAttributes(args.shellHtml, args.htmlAttributes) : args.shellHtml
  return shellHtml.includes(THEME_SLOT)
    ? shellHtml.replace(THEME_SLOT, style)
    : shellHtml.replace(/<\/head>/i, `${style}</head>`)
}
```

In `components/editor/ThemePreview.tsx`, replace the `useMemo` block with:

```tsx
  const srcDoc = useMemo(
    () =>
      composePreviewSrcDoc({
        shellHtml,
        themeCss: sources.themeCss,
        overridesCss: sources.overridesCss,
        typography: sources.typography,
        // The shell carries the LIVE treatment attributes; override them with
        // the draft values so treatment toggles preview instantly.
        htmlAttributes: {
          'data-headline': sources.headlineStyle,
          'data-eyebrow': sources.eyebrowStyle,
        },
      }),
    [shellHtml, sources.themeCss, sources.overridesCss, sources.typography, sources.headlineStyle, sources.eyebrowStyle]
  )
```

In `components/editor/ThemeControls.tsx`, replace the notice paragraph text (lines 251–253) with:

```tsx
      <p className="font-body text-[11px] text-text-muted">
        Headline and eyebrow treatments preview here when the deployed site&rsquo;s template supports them. Dark sections apply only after the site rebuilds.
      </p>
```

- [ ] **Step 4: Run the tests and the type check.**
Run: `npx vitest run lib/theme-preview/preview.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit.**

```bash
git add lib/theme-preview/compose-srcdoc.ts lib/theme-preview/preview.test.ts components/editor/ThemePreview.tsx components/editor/ThemeControls.tsx
git commit -m "fix(theme-studio): preview headline/eyebrow treatments by rewriting <html> attributes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Strict design CSS sanitizer

This is the gate for every piece of AI-written CSS that lands in `content/design-overrides.css`. The template compiles that file into the client's Vercel build (`globals.css` `@import`s it through Tailwind v4 / LightningCSS), so bad CSS breaks the deploy, not only the preview. This task also routes the existing theme chat's `set_block_override` through the sanitizer.

**Files:**
- Modify: `package.json` (move to direct deps)
- Create: `lib/design/css-targets.ts`
- Create: `lib/design/css-sanitizer.ts`
- Test: `lib/design/css-sanitizer.test.ts`
- Modify: `app/api/edit/[id]/theme/chat/route.ts` (the `set_block_override` `execute`, around line 268)

**Interfaces:**
- Consumes: `OVERRIDE_BLOCKS` from `lib/editor/theme-edit.ts`.
- Produces:
  - `lib/design/css-targets.ts`:
    - `CHROME_COMPONENTS = ['navbar','footer','cookie-consent'] as const`
    - `CSS_TARGETS = [...OVERRIDE_BLOCKS, ...CHROME_COMPONENTS] as const`
    - `type CssTarget = (typeof CSS_TARGETS)[number]`
    - `HTML_STATE_ATTRS: readonly string[] = ['data-headline','data-eyebrow']`
    - `isCssTarget(s: string): s is CssTarget`
  - `lib/design/css-sanitizer.ts`:
    - `type CssScope = { kind: 'target'; target: CssTarget } | { kind: 'global' }`
    - `type SanitizeResult = { ok: true; css: string } | { ok: false; errors: string[] }`
    - `sanitizeDesignCss(css: string, scope: CssScope): SanitizeResult`

- [ ] **Step 1: Make the CSS toolchain direct dependencies.** All three packages are already installed transitively (via `@tailwindcss/postcss`), so this only pins them.

Run: `npm install --save-exact postcss@8.5.23 postcss-selector-parser@7.1.6 lightningcss@1.32.0`
Expected: `package.json` `dependencies` now list all three. `git diff package-lock.json` shows only root-level dependency changes.

- [ ] **Step 2: Create `lib/design/css-targets.ts`.**

```ts
// Pure, client-safe vocabulary of what design CSS may target. Shared by the
// sanitizer (server) and the DesignBundle schema (client-safe).
import { OVERRIDE_BLOCKS } from '@/lib/editor/theme-edit'

// Site chrome the template marks with data-component (navbar, footer, cookie
// consent) — styleable like a block.
export const CHROME_COMPONENTS = ['navbar', 'footer', 'cookie-consent'] as const

export const CSS_TARGETS = [...OVERRIDE_BLOCKS, ...CHROME_COMPONENTS] as const
export type CssTarget = (typeof CSS_TARGETS)[number]

export function isCssTarget(s: string): s is CssTarget {
  return (CSS_TARGETS as readonly string[]).includes(s)
}

// <html> state attributes the template sets from design.json. CSS may key off
// them (html[data-headline="serif"] [data-block="hero"] …). P6b adds style axes.
export const HTML_STATE_ATTRS: readonly string[] = ['data-headline', 'data-eyebrow']
```

- [ ] **Step 3: Write the failing tests** in `lib/design/css-sanitizer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeDesignCss, type CssScope } from './css-sanitizer'

const HERO: CssScope = { kind: 'target', target: 'hero' }
const GLOBAL: CssScope = { kind: 'global' }

function ok(css: string, scope: CssScope = HERO): string {
  const r = sanitizeDesignCss(css, scope)
  if (!r.ok) throw new Error(`expected ok, got: ${r.errors.join(' | ')}`)
  return r.css
}
function errs(css: string, scope: CssScope = HERO): string {
  const r = sanitizeDesignCss(css, scope)
  if (r.ok) throw new Error(`expected rejection, got: ${r.css}`)
  return r.errors.join(' | ')
}

describe('sanitizeDesignCss — accepts', () => {
  it('a rule scoped to the target block', () => {
    expect(ok('[data-block="hero"] h1 { font-size: 3.5rem; }')).toContain('[data-block="hero"] h1')
  })
  it('a treatment-state prefix on html', () => {
    ok('html[data-headline="serif"] [data-block="hero"] h1 { letter-spacing: -0.02em; }')
  })
  it('@media / @supports / @container wrapping scoped rules', () => {
    ok('@media (min-width: 768px) { [data-block="hero"] { padding-block: 6rem; } }')
    ok('@supports (display: grid) { [data-block="hero"] { display: grid; } }')
  })
  it('nested rules under a scoped parent', () => {
    ok('[data-block="hero"] { & h1 { color: var(--color-primary); } }')
  })
  it('c5- keyframes plus an animation gated on reduced motion', () => {
    ok(
      '@keyframes c5-rise { from { opacity: 0; } to { opacity: 1; } }\n' +
        '@media (prefers-reduced-motion: no-preference) { [data-block="hero"] h1 { animation: c5-rise .6s ease-out; } }'
    )
  })
  it('a small inline svg data url', () => {
    ok(`[data-block="hero"] { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"); }`)
  })
  it('global scope: several targets and :root custom properties', () => {
    ok(
      ':root { --c5-section-gap: 5rem; --shadow-card: 0 8px 24px rgb(0 59 113 / .12); }\n' +
        '[data-block="feature-grid"] h3 { font-weight: 600; }\n' +
        '[data-component="footer"] { border-top: 1px solid var(--color-border); }',
      GLOBAL
    )
  })
  it('a chrome component target', () => {
    ok('[data-component="navbar"] { position: sticky; top: 0; }', { kind: 'target', target: 'navbar' })
  })
  it('strips comments so managed-region markers cannot be forged', () => {
    const css = ok('/* design-studio:end */ [data-block="hero"] { color: red; }')
    expect(css).not.toContain('design-studio')
  })
})

describe('sanitizeDesignCss — rejects', () => {
  it.each([
    ['@import', '@import url("x.css");', '@import'],
    ['@apply', '[data-block="hero"] { @apply text-lg; }', '@apply'],
    ['@theme', '@theme { --color-x: red; }', '@theme'],
    ['@tailwind', '@tailwind utilities;', '@tailwind'],
    ['@layer', '@layer base { [data-block="hero"] { color: red; } }', '@layer'],
    ['@font-face', '@font-face { font-family: x; src: local(x); }', '@font-face'],
    ['non-c5 keyframes', '@keyframes spin { to { opacity: 1; } }', 'c5-'],
  ])('banned at-rule: %s', (_n, css, needle) => {
    expect(errs(css)).toContain(needle)
  })

  it.each([
    ['unscoped tag', 'h1 { color: red; }'],
    ['body', 'body { color: red; }'],
    ['universal', '* { color: red; }'],
    ['other block', '[data-block="faq-accordion"] { color: red; }'],
    ['unknown html attr', 'html[data-foo="x"] [data-block="hero"] { color: red; }'],
    ['html alone', 'html[data-headline="serif"] { color: red; }'],
    [':root in target scope', ':root { --c5-x: 1px; }'],
  ])('bad selector: %s', (_n, css) => {
    expect(errs(css)).toMatch(/selector/i)
  })

  it('rejects an unknown block even in global scope', () => {
    expect(errs('[data-block="nope"] { color: red; }', GLOBAL)).toMatch(/selector/i)
  })

  it('rejects :root properties outside the allowed custom-property prefixes', () => {
    expect(errs(':root { --color-primary: red; }', GLOBAL)).toContain('--color-primary')
    expect(errs(':root { color: red; }', GLOBAL)).toContain(':root')
  })

  it.each([
    ['display none', 'display: none'],
    ['visibility hidden', 'visibility: hidden'],
    ['low opacity', 'opacity: 0.1'],
    ['content injection', 'content: "Call now"'],
    ['fixed position', 'position: fixed'],
    ['transparent text', 'color: transparent'],
    ['tiny font px', 'font-size: 10px'],
    ['tiny font rem', 'font-size: 0.6rem'],
    ['huge z-index', 'z-index: 999'],
    ['pointer-events', 'pointer-events: none'],
    ['behavior', 'behavior: url(x.htc)'],
    ['expression', 'width: expression(alert(1))'],
  ])('hiding / injection declaration: %s', (_n, decl) => {
    expect(errs(`[data-block="hero"] { ${decl}; }`)).toMatch(/not allowed|too small|too high/i)
  })

  it.each([
    ['remote url', 'url("https://evil.test/x.png")'],
    ['relative url', 'url(/img/x.png)'],
    ['svg with script', `url("data:image/svg+xml,%3Csvg%3E%3Cscript%3E%3C/script%3E%3C/svg%3E")`],
    ['png data url', 'url("data:image/png;base64,AAAA")'],
  ])('bad url(): %s', (_n, u) => {
    expect(errs(`[data-block="hero"] { background-image: ${u}; }`)).toContain('url(')
  })

  it('rejects an animation not gated on prefers-reduced-motion', () => {
    expect(errs('[data-block="hero"] { animation: c5-rise 1s; }')).toContain('prefers-reduced-motion')
  })

  it('rejects more than 5 !important', () => {
    const decls = Array.from({ length: 6 }, (_, i) => `margin-top: ${i}px !important;`).join(' ')
    expect(errs(`[data-block="hero"] { ${decls} }`)).toContain('!important')
  })

  it('rejects a target fragment over 60 lines', () => {
    const decls = Array.from({ length: 70 }, (_, i) => `  --c5-x${i}: ${i}px;`).join('\n')
    expect(errs(`[data-block="hero"] {\n${decls}\n}`)).toContain('lines')
  })

  it('rejects markup', () => {
    expect(errs('[data-block="hero"] { color: red; } </style><script>')).toMatch(/markup/i)
  })

  it('rejects CSS that does not parse', () => {
    expect(errs('[data-block="hero"] { color: red;')).toMatch(/parse/i)
    expect(errs('[data-block="hero" h1 { color: red; }')).toMatch(/parse|selector/i)
  })

  it('rejects empty input', () => {
    expect(errs('   ')).toMatch(/empty/i)
  })
})
```

- [ ] **Step 4: Run them and confirm they fail.**
Run: `npx vitest run lib/design/css-sanitizer.test.ts`
Expected: FAIL, because `./css-sanitizer` does not exist.

- [ ] **Step 5: Implement `lib/design/css-sanitizer.ts`.**

```ts
// Server-only (imports the native lightningcss module — never import this from
// a 'use client' file). Strict gate for every piece of AI- or admin-authored CSS
// that lands in a client's content/design-overrides.css. That file is compiled
// by the client's Vercel build (globals.css @imports it through Tailwind v4 /
// LightningCSS), so invalid CSS breaks the deploy, not just the preview.
//
// Rules: postcss must parse it; only @media/@supports/@container and @keyframes
// c5-* are allowed; every top-level selector must lead with an allowed target
// ([data-block], [data-component], optional html[data-<state>] prefix, or :root
// custom properties in global scope); hiding/injection declarations are refused;
// url() is limited to small inline SVG; LightningCSS must accept the result.
import postcss, { type AtRule, type ChildNode, type Container, type Declaration, type Rule } from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { transform } from 'lightningcss'
import { OVERRIDE_BLOCKS } from '@/lib/editor/theme-edit'
import { CHROME_COMPONENTS, HTML_STATE_ATTRS, type CssTarget } from './css-targets'

export type CssScope = { kind: 'target'; target: CssTarget } | { kind: 'global' }
export type SanitizeResult = { ok: true; css: string } | { ok: false; errors: string[] }

const MAX_GLOBAL_BYTES = 16_000
const MAX_GLOBAL_LINES = 400
const MAX_TARGET_BYTES = 4_000
const MAX_TARGET_LINES = 60
const MAX_IMPORTANT = 5
const MAX_SVG_URL_CHARS = 2_048

const ALLOWED_AT_RULES = new Set(['media', 'supports', 'container', 'keyframes'])
// :root may only set design-scale custom properties — never --color-* (owned by
// theme.css) or --font-*-loaded (owned by the fonts module).
const ROOT_PROP_PREFIXES = ['--c5-', '--type-', '--tracking-', '--shadow-', '--overlay-', '--duration-']

type LeadTarget = { kind: 'block' | 'component'; id: string } | { kind: 'root' }

// The target a single (non-nested) selector leads with, or null when it isn't
// scoped to one. Accepts an optional `html[data-<state>]…` prefix.
function leadingTarget(sel: selectorParser.Selector): LeadTarget | null {
  const nodes = sel.nodes
  if (nodes.length === 1 && nodes[0].type === 'pseudo' && nodes[0].value === ':root') return { kind: 'root' }
  let i = 0
  if (nodes[0]?.type === 'tag' && nodes[0].value === 'html') {
    i = 1
    while (nodes[i]?.type === 'attribute') {
      const a = nodes[i] as selectorParser.Attribute
      if (!HTML_STATE_ATTRS.includes(a.attribute)) return null
      i++
    }
    if (nodes[i]?.type !== 'combinator') return null
    i++
  }
  for (; i < nodes.length && nodes[i].type !== 'combinator'; i++) {
    const n = nodes[i]
    if (n.type === 'attribute' && n.operator === '=' && (n.attribute === 'data-block' || n.attribute === 'data-component')) {
      return { kind: n.attribute === 'data-block' ? 'block' : 'component', id: n.value ?? '' }
    }
  }
  return null
}

function targetAllowed(t: LeadTarget, scope: CssScope): boolean {
  if (scope.kind === 'target') {
    if (t.kind === 'root') return false
    return t.id === scope.target
  }
  if (t.kind === 'root') return true
  if (t.kind === 'block') return (OVERRIDE_BLOCKS as readonly string[]).includes(t.id)
  return (CHROME_COMPONENTS as readonly string[]).includes(t.id)
}

function hasAncestor(node: ChildNode, pred: (n: Container) => boolean): boolean {
  let p = node.parent
  while (p && p.type !== 'root') {
    if (pred(p as Container)) return true
    p = p.parent
  }
  return false
}

const isRule = (n: Container): boolean => n.type === 'rule'
const isKeyframes = (n: Container): boolean => n.type === 'atrule' && (n as AtRule).name.toLowerCase() === 'keyframes'
const isReducedMotionGate = (n: Container): boolean =>
  n.type === 'atrule' &&
  (n as AtRule).name.toLowerCase() === 'media' &&
  /prefers-reduced-motion\s*:\s*no-preference/i.test((n as AtRule).params)

function checkUrls(value: string, errors: string[]) {
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(value))) {
    const raw = m[2]
    if (!/^data:image\/svg\+xml[,;]/i.test(raw)) {
      errors.push('url() may only embed a small inline SVG (data:image/svg+xml) — no remote, relative, or raster URLs.')
      continue
    }
    if (raw.length > MAX_SVG_URL_CHARS) errors.push('url() inline SVG is too large (max 2 KB).')
    let decoded = raw
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      // Keep the raw text; the checks below still apply.
    }
    if (/<script|\bon[a-z]+\s*=|javascript:/i.test(decoded)) errors.push('url() inline SVG contains script — not allowed.')
  }
}

function checkDeclaration(decl: Declaration, lead: LeadTarget | null, errors: string[]) {
  const prop = decl.prop.toLowerCase()
  const value = decl.value.trim().toLowerCase()
  const inKeyframes = hasAncestor(decl, isKeyframes)

  if (prop === 'behavior' || prop === '-moz-binding') errors.push(`${prop} is not allowed.`)
  if (/expression\(|javascript:/.test(value)) errors.push(`${prop}: ${decl.value} is not allowed.`)
  if (prop === 'display' && value === 'none') errors.push('display: none is not allowed (it hides content).')
  if (prop === 'visibility' && (value === 'hidden' || value === 'collapse')) errors.push(`visibility: ${value} is not allowed.`)
  if (prop === 'opacity' && !inKeyframes) {
    const n = value.endsWith('%') ? parseFloat(value) / 100 : parseFloat(value)
    if (!Number.isNaN(n) && n < 0.2) errors.push(`opacity: ${decl.value} is not allowed (below 0.2 hides content).`)
  }
  if (prop === 'content' && !['""', "''", 'none'].includes(value) && !value.startsWith('counter(')) {
    errors.push('content: text is not allowed (no injected copy).')
  }
  if (prop === 'position' && (value === 'fixed' || value === 'sticky')) {
    const navbar = lead?.kind === 'component' && lead.id === 'navbar'
    if (!navbar) errors.push(`position: ${value} is not allowed outside the navbar.`)
  }
  if ((prop === 'color' || prop === '-webkit-text-fill-color') && value === 'transparent') {
    errors.push(`${prop}: transparent is not allowed (it hides text).`)
  }
  if (prop === 'font-size') {
    const m = /^([\d.]+)(px|rem|em)$/.exec(value)
    if (m) {
      const n = parseFloat(m[1])
      if ((m[2] === 'px' && n < 12) || (m[2] !== 'px' && n < 0.75)) errors.push(`font-size: ${decl.value} is too small (min 12px / 0.75rem).`)
    }
  }
  if (prop === 'z-index') {
    const n = parseInt(value, 10)
    if (!Number.isNaN(n) && n > 50) errors.push(`z-index: ${decl.value} is too high (max 50).`)
  }
  if (prop === 'pointer-events' && value === 'none') errors.push('pointer-events: none is not allowed.')
  if ((prop === 'animation' || prop === 'animation-name') && !hasAncestor(decl, isReducedMotionGate)) {
    errors.push('animations must sit inside @media (prefers-reduced-motion: no-preference).')
  }
  if (value.includes('url(')) checkUrls(decl.value, errors)
}

export function sanitizeDesignCss(css: string, scope: CssScope): SanitizeResult {
  const input = css.trim()
  if (!input) return { ok: false, errors: ['The CSS is empty.'] }
  const maxBytes = scope.kind === 'global' ? MAX_GLOBAL_BYTES : MAX_TARGET_BYTES
  if (Buffer.byteLength(input, 'utf8') > maxBytes) return { ok: false, errors: [`The CSS is too large (max ${maxBytes} bytes).`] }
  if (/<\/|<script/i.test(input)) return { ok: false, errors: ['The CSS contains disallowed markup.'] }

  let root: postcss.Root
  try {
    root = postcss.parse(input)
  } catch (err) {
    const reason = err instanceof postcss.CssSyntaxError ? err.reason : 'syntax error'
    return { ok: false, errors: [`The CSS does not parse: ${reason}.`] }
  }

  const errors: string[] = []
  root.walkComments((c) => {
    c.remove()
  })

  root.walkAtRules((at) => {
    const name = at.name.toLowerCase()
    if (!ALLOWED_AT_RULES.has(name)) {
      errors.push(`@${at.name} is not allowed (only @media, @supports, @container, and @keyframes c5-*).`)
      return
    }
    if (name === 'keyframes' && !/^c5-[a-z0-9-]+$/i.test(at.params.trim())) {
      errors.push(`@keyframes names must start with c5- (got "${at.params.trim()}").`)
    }
  })

  let important = 0
  root.walkRules((rule: Rule) => {
    // Keyframe steps (from/to/50%) and nested rules are covered by their parent.
    if (hasAncestor(rule, isKeyframes) || hasAncestor(rule, isRule)) return
    let parsed: selectorParser.Root
    try {
      parsed = selectorParser().astSync(rule.selector)
    } catch {
      errors.push(`Selector "${rule.selector}" does not parse.`)
      return
    }
    parsed.each((sel) => {
      const lead = leadingTarget(sel)
      if (!lead || !targetAllowed(lead, scope)) {
        const where = scope.kind === 'target' ? `[data-block="${scope.target}"] / [data-component="${scope.target}"]` : 'a known [data-block] / [data-component] / :root'
        errors.push(`Selector "${sel.toString().trim()}" must be scoped to ${where}.`)
        return
      }
      rule.walkDecls((decl) => {
        if (lead.kind === 'root' && decl.parent === rule) {
          const prop = decl.prop.toLowerCase()
          if (!prop.startsWith('--')) errors.push(`:root may only set custom properties (got ${decl.prop}).`)
          else if (!ROOT_PROP_PREFIXES.some((p) => prop.startsWith(p))) {
            errors.push(`:root may not set ${decl.prop} (allowed prefixes: ${ROOT_PROP_PREFIXES.join(', ')}).`)
          }
        }
      })
    })
  })

  root.walkDecls((decl) => {
    if (decl.important) important++
    if (decl.parent?.type !== 'rule') {
      errors.push(`Declaration "${decl.prop}" must be inside a rule.`)
      return
    }
    // Find the outermost rule (nesting) to learn which target this decl styles.
    let top: ChildNode = decl.parent as Rule
    while (top.parent && top.parent.type !== 'root') top = top.parent as ChildNode
    let lead: LeadTarget | null = null
    const outer = top.type === 'rule' ? (top as Rule) : null
    const ownerRule = outer ?? (decl.parent as Rule)
    try {
      const first = selectorParser().astSync(ownerRule.selector).first
      lead = first ? leadingTarget(first) : null
    } catch {
      lead = null
    }
    checkDeclaration(decl, lead, errors)
  })
  if (important > MAX_IMPORTANT) errors.push(`Too many !important declarations (${important}; max ${MAX_IMPORTANT}).`)

  const out = root.toString().trim()
  const maxLines = scope.kind === 'global' ? MAX_GLOBAL_LINES : MAX_TARGET_LINES
  const lines = out.split('\n').length
  if (lines > maxLines) errors.push(`The CSS has ${lines} lines (max ${maxLines}).`)

  if (errors.length === 0) {
    try {
      transform({ filename: 'design-overrides.css', code: Buffer.from(out), errorRecovery: false })
    } catch (err) {
      errors.push(`The CSS does not parse in LightningCSS: ${err instanceof Error ? err.message : 'unknown error'}.`)
    }
  }

  return errors.length ? { ok: false, errors: Array.from(new Set(errors)) } : { ok: true, css: out }
}
```

Note for the implementer: `postcss.Root` is used as a type above. If tsc complains, import it as a type: `import postcss, { type Root, … } from 'postcss'` and annotate `let root: Root`.

- [ ] **Step 6: Run the sanitizer tests.**
Run: `npx vitest run lib/design/css-sanitizer.test.ts`
Expected: all PASS. For any failing case, fix the implementation, not the test, unless the test itself contradicts the rules listed in the file header. In that case stop and report.

- [ ] **Step 7: Route the theme chat's block CSS through the sanitizer.** In `app/api/edit/[id]/theme/chat/route.ts`:
  1. Add the import `import { sanitizeDesignCss } from '@/lib/design/css-sanitizer'`.
  2. In the `set_block_override` tool's `execute`, replace the first line `const res = upsertBlockOverride(files[OVERRIDES_PATH].content, block, css)` with:

```ts
          const clean = sanitizeDesignCss(css, { kind: 'target', target: block })
          if (!clean.ok) return { error: `CSS rejected: ${clean.errors.join(' ')}` }
          const res = upsertBlockOverride(files[OVERRIDES_PATH].content, block, clean.css)
```

(`block` is typed `z.enum(OVERRIDE_BLOCKS)`, which is a subset of `CssTarget`, so no cast is needed.)

- [ ] **Step 8: Run the checks.**
Run: `npx tsc --noEmit && npx vitest run lib/design lib/editor && npm run build`
Expected: tsc exits 0, tests pass, and the build succeeds. The build proves lightningcss never ends up in a client bundle; a failure mentioning `lightningcss` / `fs` in a client chunk means something `'use client'` imported the sanitizer.

- [ ] **Step 9: Commit.**

```bash
git add package.json package-lock.json lib/design/css-targets.ts lib/design/css-sanitizer.ts lib/design/css-sanitizer.test.ts "app/api/edit/[id]/theme/chat/route.ts"
git commit -m "feat(design-studio): strict design CSS sanitizer; gate theme chat block overrides through it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: DesignBundle schema

**Files:**
- Modify: `lib/editor/theme-edit.ts`. Export the two existing regex constants: change `const HEX_RE` to `export const HEX_RE` and `const LENGTH_RE` to `export const LENGTH_RE`.
- Create: `lib/design/bundle.ts`
- Create: `lib/design/__fixtures__/valid-bundle.ts` (shared `VALID` fixture)
- Test: `lib/design/bundle.test.ts`

**Interfaces:**
- Consumes: `PALETTE_ROLES`, `HEX_RE`, `LENGTH_RE` from `lib/editor/theme-edit.ts`; `CURATED_FONTS` from `lib/content/type-pairing-catalog.ts`; `CSS_TARGETS` from `lib/design/css-targets.ts`.
- Produces (client-safe):
  - `DesignBundleSchema` (zod)
  - `type DesignBundle = z.infer<typeof DesignBundleSchema>`
  - `BUNDLE_SOURCES = ['baseline','concept','chat','revert','import'] as const`
  - `parseDesignBundle(input: unknown): { ok: true; bundle: DesignBundle } | { ok: false; errors: string[] }`

The bundle shape:
- `schemaVersion: 1`, `name`, `tagline`, `rationale`, `moves[]`
- `palette{6 roles}`
- `typography{headingFont, bodyFont, accentFont}` (no `googleFontsUrl`; it is derived)
- `tokens{roundness, density, visualFeel, spacing{xs..2xl}, radius{none..pill}}`
- `treatments{headlineStyle, eyebrowStyle, darkSections}`
- `css{global?, blocks: Partial<Record<CssTarget, string>>}`
- `meta{source, model?}`

`style` (the axes) arrives in P6b. CSS strings are **not** sanitized by the schema, because the schema is client-safe; `bundleToRepoFiles` sanitizes them.

- [ ] **Step 1: Write the shared fixture and the failing tests.** Other test files import the fixture, so it must live in its own file; importing it from a `.test.ts` would re-register that file's tests. Create `lib/design/__fixtures__/valid-bundle.ts`:

```ts
import type { DesignBundle } from '../bundle'

export const VALID: DesignBundle = {
  schemaVersion: 1,
  name: 'Harbor Ledger',
  tagline: 'Calm authority with a warm serif voice',
  rationale: 'The MBP asks for trustworthy, modern, never stuffy.',
  moves: ['Serif statement headlines', 'Ink footer band'],
  palette: {
    primary: '#003b71',
    secondary: '#e8eef5',
    complementary: '#c46a2b',
    action: '#00c1de',
    nearBlack: '#101820',
    nearWhite: '#fafaf7',
  },
  typography: { headingFont: 'Public Sans', bodyFont: 'Public Sans', accentFont: 'Fraunces' },
  tokens: {
    roundness: 'soft',
    density: 'balanced',
    visualFeel: 'editorial',
    spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '48px', '2xl': '96px' },
    radius: { none: '0px', sm: '4px', md: '8px', lg: '16px', pill: '9999px' },
  },
  treatments: { headlineStyle: 'serif', eyebrowStyle: 'mono', darkSections: true },
  css: { blocks: { hero: '[data-block="hero"] h1 { letter-spacing: -0.02em; }' } },
  meta: { source: 'concept', model: 'claude-opus-5-5' },
}
```

Then create `lib/design/bundle.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseDesignBundle } from './bundle'
import { VALID } from './__fixtures__/valid-bundle'

describe('parseDesignBundle', () => {
  it('accepts a valid bundle and lowercases hex colours', () => {
    const r = parseDesignBundle({ ...VALID, palette: { ...VALID.palette, primary: '#003B71' } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.bundle.palette.primary).toBe('#003b71')
  })

  it('fills optional narrative fields with defaults', () => {
    const { tagline: _t, rationale: _r, moves: _m, ...rest } = VALID
    const r = parseDesignBundle(rest)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.bundle.moves).toEqual([])
  })

  it.each([
    ['bad hex', { palette: { ...VALID.palette, action: 'teal' } }, 'palette.action'],
    ['uncurated font', { typography: { ...VALID.typography, headingFont: 'Comic Sans MS' } }, 'typography.headingFont'],
    ['bad length', { tokens: { ...VALID.tokens, spacing: { ...VALID.tokens.spacing, md: '16 px; color:red' } } }, 'tokens.spacing.md'],
    ['bad enum', { tokens: { ...VALID.tokens, roundness: 'round' } }, 'tokens.roundness'],
    ['unknown css target', { css: { blocks: { sidebar: 'x' } } }, 'css.blocks'],
    ['wrong schemaVersion', { schemaVersion: 2 }, 'schemaVersion'],
  ])('rejects %s', (_n, patch, path) => {
    const r = parseDesignBundle({ ...VALID, ...patch })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain(path)
  })
})
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `npx vitest run lib/design/bundle.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `lib/design/bundle.ts`.**

```ts
// The canonical, versionable Design Studio design: everything a concept, a chat
// revision, or a restore needs to fully reproduce a client's look. Pure +
// client-safe (zod only). CSS strings are NOT sanitized here — the server-side
// bundleToRepoFiles() runs every fragment through sanitizeDesignCss().
import { z } from 'zod'
import { PALETTE_ROLES, HEX_RE, LENGTH_RE } from '@/lib/editor/theme-edit'
import { CURATED_FONTS } from '@/lib/content/type-pairing-catalog'
import { CSS_TARGETS } from './css-targets'

export const BUNDLE_SOURCES = ['baseline', 'concept', 'chat', 'revert', 'import'] as const

const hex = z.string().regex(HEX_RE, 'must be a #rrggbb hex colour').transform((s) => s.toLowerCase())
const length = z.string().regex(LENGTH_RE, 'must be a CSS length like 16px or 1.5rem')
const font = z.string().refine((f) => CURATED_FONTS.includes(f), 'must be a font from the curated list')

const paletteShape = Object.fromEntries(PALETTE_ROLES.map((r) => [r, hex])) as Record<
  (typeof PALETTE_ROLES)[number],
  typeof hex
>

export const DesignBundleSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(60),
  tagline: z.string().max(160).default(''),
  rationale: z.string().max(2000).default(''),
  moves: z.array(z.string().max(200)).max(6).default([]),
  palette: z.object(paletteShape),
  typography: z.object({ headingFont: font, bodyFont: font, accentFont: font }),
  tokens: z.object({
    roundness: z.enum(['sharp', 'soft', 'pill']),
    density: z.enum(['tight', 'balanced', 'airy']),
    visualFeel: z.enum(['classic', 'modern', 'editorial']),
    spacing: z.object({ xs: length, sm: length, md: length, lg: length, xl: length, '2xl': length }),
    radius: z.object({ none: length, sm: length, md: length, lg: length, pill: length }),
  }),
  treatments: z.object({
    headlineStyle: z.enum(['sans', 'serif']),
    eyebrowStyle: z.enum(['standard', 'mono']),
    darkSections: z.boolean(),
  }),
  css: z.object({
    global: z.string().optional(),
    blocks: z.partialRecord(z.enum(CSS_TARGETS), z.string()),
  }),
  meta: z.object({ source: z.enum(BUNDLE_SOURCES), model: z.string().optional() }),
})

export type DesignBundle = z.infer<typeof DesignBundleSchema>

export function parseDesignBundle(
  input: unknown
): { ok: true; bundle: DesignBundle } | { ok: false; errors: string[] } {
  const r = DesignBundleSchema.safeParse(input)
  if (r.success) return { ok: true, bundle: r.data }
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
}
```

- [ ] **Step 4: Run the tests and the type check.**
Run: `npx vitest run lib/design/bundle.test.ts && npx tsc --noEmit`
Expected: PASS. If `z.partialRecord` is missing (check with `grep -n "partialRecord" node_modules/zod/v4/classic/schemas.d.ts`), use `z.record(z.enum(CSS_TARGETS), z.string()).and(z.object({}))` or check keys with `z.record(z.string(), z.string()).refine(o => Object.keys(o).every(isCssTarget), 'unknown css target')`, keeping the error path `css.blocks`.

- [ ] **Step 5: Commit.**

```bash
git add lib/editor/theme-edit.ts lib/design/bundle.ts lib/design/bundle.test.ts lib/design/__fixtures__/valid-bundle.ts
git commit -m "feat(design-studio): DesignBundle zod schema

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Bundle ⇄ repo files (managed overrides region)

**Files:**
- Create: `lib/design/bundle-files.ts`
- Test: `lib/design/bundle-files.test.ts`

**Interfaces:**
- Consumes:
  - `DesignBundle`, `parseDesignBundle` (Task 4)
  - `sanitizeDesignCss` (Task 3); `CSS_TARGETS`, `isCssTarget` (Task 3)
  - `patchDesignFlags` from `lib/editor/theme-edit.ts`
  - `generateThemeCss` from `lib/content/theme-css-generator.ts`
  - `gfUrl` from `lib/content/type-pairing-catalog.ts`
  - `normalizeTypography` from `@/app/api/edit/[id]/theme/_theme`
- Produces (server-only):
  - `REGION_BEGIN = '/* design-studio:begin */'`, `REGION_END = '/* design-studio:end */'`, `MANAGED_HEADER`
  - `type RepoThemeFiles = { brandText: string; designText: string; overridesCss: string }`
  - `type RenderedThemeFiles = { brandText: string; designText: string; themeCss: string; overridesCss: string }`
  - `readRegion(overridesCss: string): { global?: string; blocks: Partial<Record<CssTarget, string>> }`
  - `removeRegion(overridesCss: string): string`
  - `composeRegion(css: DesignBundle['css']): string` (`''` when empty)
  - `bundleFromRepoFiles(files: RepoThemeFiles, meta: { name: string; source: DesignBundle['meta']['source'] }): { ok: true; bundle: DesignBundle } | { ok: false; errors: string[] }`
  - `bundleToRepoFiles(bundle: DesignBundle, current: RepoThemeFiles, opts: { removeLegacy: boolean }): { ok: true; files: RenderedThemeFiles } | { ok: false; errors: string[] }`

- [ ] **Step 1: Write the failing tests** in `lib/design/bundle-files.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  REGION_BEGIN,
  REGION_END,
  MANAGED_HEADER,
  readRegion,
  removeRegion,
  composeRegion,
  bundleFromRepoFiles,
  bundleToRepoFiles,
} from './bundle-files'
import { generateThemeCss } from '@/lib/content/theme-css-generator'
import { VALID } from './__fixtures__/valid-bundle'

const FIX = path.join(__dirname, '..', 'content', '__fixtures__')
const brandText = readFileSync(path.join(FIX, 'brand.golden.json'), 'utf-8')
const designText = readFileSync(path.join(FIX, 'design.golden.json'), 'utf-8')
const LEGACY = '/* theme-editor:hero */\n[data-block="hero"] { color: red; }\n/* /theme-editor:hero */\n'

describe('managed region', () => {
  it('composes and reads back fragments in stable order', () => {
    const region = composeRegion({ global: ':root { --c5-gap: 4rem; }', blocks: { footer: '[data-component="footer"] { padding: 2rem; }', hero: '[data-block="hero"] { color: red; }' } })
    expect(region.startsWith(REGION_BEGIN)).toBe(true)
    expect(region.trimEnd().endsWith(REGION_END)).toBe(true)
    expect(region.indexOf('design-studio:global')).toBeLessThan(region.indexOf('design-studio:hero'))
    expect(region.indexOf('design-studio:hero')).toBeLessThan(region.indexOf('design-studio:footer'))
    const back = readRegion(`${LEGACY}\n${region}`)
    expect(back.global).toBe(':root { --c5-gap: 4rem; }')
    expect(back.blocks.hero).toBe('[data-block="hero"] { color: red; }')
  })

  it('is empty when there are no fragments', () => {
    expect(composeRegion({ blocks: {} })).toBe('')
  })

  it('removeRegion keeps everything outside the region', () => {
    const region = composeRegion({ blocks: { hero: '[data-block="hero"] { color: red; }' } })
    expect(removeRegion(`${LEGACY}\n${region}`)).toBe(LEGACY.trimEnd())
  })
})

describe('bundleFromRepoFiles', () => {
  it('builds a baseline bundle from the golden fixtures', () => {
    const r = bundleFromRepoFiles({ brandText, designText, overridesCss: '' }, { name: 'Current site', source: 'baseline' })
    if (!r.ok) throw new Error(r.errors.join(' | '))
    expect(r.bundle.palette.primary).toBe(JSON.parse(brandText).palette.primary.toLowerCase())
    expect(r.bundle.typography.accentFont).toBe('Fraunces') // normalized: golden lacks accentFont
    expect(r.bundle.treatments).toEqual({ headlineStyle: 'sans', eyebrowStyle: 'standard', darkSections: false })
    expect(r.bundle.css.blocks).toEqual({})
  })
})

describe('bundleToRepoFiles', () => {
  it('round-trips the baseline: palette unchanged and theme.css regenerated from the output', () => {
    const base = bundleFromRepoFiles({ brandText, designText, overridesCss: '' }, { name: 'Current site', source: 'baseline' })
    if (!base.ok) throw new Error('baseline failed')
    const r = bundleToRepoFiles(base.bundle, { brandText, designText, overridesCss: '' }, { removeLegacy: false })
    if (!r.ok) throw new Error(r.errors.join(' | '))
    // The golden fixture's hexes are uppercase; the bundle normalizes to lowercase.
    const golden = JSON.parse(brandText)
    const lowered = Object.fromEntries(Object.entries(golden.palette).map(([k, v]) => [k, String(v).toLowerCase()]))
    expect(JSON.parse(r.files.brandText)).toEqual({ ...golden, palette: lowered })
    expect(r.files.brandText.endsWith('}\n')).toBe(true)
    expect(r.files.themeCss).toBe(generateThemeCss(JSON.parse(r.files.brandText), JSON.parse(r.files.designText)))
    expect(r.files.overridesCss).toBe('')
  })

  it('applies palette, fonts, tokens, treatments and derives googleFontsUrl', () => {
    const r = bundleToRepoFiles(VALID, { brandText, designText, overridesCss: '' }, { removeLegacy: false })
    if (!r.ok) throw new Error(r.errors.join(' | '))
    const brand = JSON.parse(r.files.brandText)
    const design = JSON.parse(r.files.designText)
    expect(brand.palette.action).toBe('#00c1de')
    expect(brand.firm).toEqual(JSON.parse(brandText).firm) // non-palette fields untouched
    expect(design.typography.accentFont).toBe('Fraunces')
    expect(design.typography.googleFontsUrl).toContain('family=Public+Sans')
    expect(design.visualFeel).toBe('editorial')
    expect(design.headlineStyle).toBe('serif')
    expect(design.darkSections).toBe(true)
    expect(r.files.overridesCss).toContain('design-studio:hero')
  })

  it('omits default treatments from design.json', () => {
    const b = { ...VALID, treatments: { headlineStyle: 'sans' as const, eyebrowStyle: 'standard' as const, darkSections: false } }
    const r = bundleToRepoFiles(b, { brandText, designText, overridesCss: '' }, { removeLegacy: false })
    if (!r.ok) throw new Error('failed')
    const design = JSON.parse(r.files.designText)
    expect('headlineStyle' in design).toBe(false)
    expect('darkSections' in design).toBe(false)
  })

  it('keeps legacy CSS by default and replaces only the region', () => {
    const old = `${LEGACY}\n${composeRegion({ blocks: { hero: '[data-block="hero"] { color: blue; }' } })}`
    const r = bundleToRepoFiles(VALID, { brandText, designText, overridesCss: old }, { removeLegacy: false })
    if (!r.ok) throw new Error('failed')
    expect(r.files.overridesCss).toContain('theme-editor:hero')
    expect(r.files.overridesCss).not.toContain('color: blue')
    expect(r.files.overridesCss.match(/design-studio:begin/g)).toHaveLength(1)
  })

  it('removeLegacy drops everything outside the region and writes the managed header', () => {
    const r = bundleToRepoFiles(VALID, { brandText, designText, overridesCss: LEGACY }, { removeLegacy: true })
    if (!r.ok) throw new Error('failed')
    expect(r.files.overridesCss.startsWith(MANAGED_HEADER.trimEnd())).toBe(true)
    expect(r.files.overridesCss).not.toContain('theme-editor')
  })

  it('rejects a bundle whose CSS fails the sanitizer, naming the fragment', () => {
    const bad = { ...VALID, css: { blocks: { hero: 'body { display: none; }' } } }
    const r = bundleToRepoFiles(bad, { brandText, designText, overridesCss: '' }, { removeLegacy: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('css.blocks.hero')
  })

  it('rejects invalid brand.json text', () => {
    const r = bundleToRepoFiles(VALID, { brandText: '{nope', designText, overridesCss: '' }, { removeLegacy: false })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `npx vitest run lib/design/bundle-files.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `lib/design/bundle-files.ts`.**

```ts
// Server-only (via css-sanitizer). Pure conversion between a DesignBundle and
// the client repo's theme files. brand.json + design.json are rewritten in
// place (non-design fields untouched, 2-space + trailing newline); theme.css is
// ALWAYS regenerated; design-overrides.css gets a single Studio-managed region
// that is replaced wholesale on every apply. Nothing here touches the network.
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { patchDesignFlags } from '@/lib/editor/theme-edit'
import { generateThemeCss } from '@/lib/content/theme-css-generator'
import { gfUrl } from '@/lib/content/type-pairing-catalog'
import { normalizeTypography } from '@/app/api/edit/[id]/theme/_theme'
import { parseDesignBundle, type DesignBundle } from './bundle'
import { sanitizeDesignCss } from './css-sanitizer'
import { CSS_TARGETS, isCssTarget, type CssTarget } from './css-targets'

export const REGION_BEGIN = '/* design-studio:begin */'
export const REGION_END = '/* design-studio:end */'
export const MANAGED_HEADER =
  '/* design-overrides.css — managed by the Revaltus Design Studio.\n * The design-studio region below is regenerated on every apply; edit it through the Studio. */\n'

export type RepoThemeFiles = { brandText: string; designText: string; overridesCss: string }
export type RenderedThemeFiles = { brandText: string; designText: string; themeCss: string; overridesCss: string }

const serialize = (obj: unknown): string => JSON.stringify(obj, null, 2) + '\n'
const fragStart = (key: string) => `/* design-studio:${key} */`
const fragEnd = (key: string) => `/* /design-studio:${key} */`

function regionBounds(css: string): { start: number; end: number } | null {
  const start = css.indexOf(REGION_BEGIN)
  if (start === -1) return null
  const endIdx = css.indexOf(REGION_END, start)
  if (endIdx === -1) return null
  return { start, end: endIdx + REGION_END.length }
}

export function readRegion(overridesCss: string): DesignBundle['css'] {
  const out: DesignBundle['css'] = { blocks: {} }
  const b = regionBounds(overridesCss)
  if (!b) return out
  const region = overridesCss.slice(b.start, b.end)
  const re = /\/\* design-studio:([a-z-]+) \*\/\n([\s\S]*?)\n\/\* \/design-studio:\1 \*\//g
  let m: RegExpExecArray | null
  while ((m = re.exec(region))) {
    const [, key, body] = m
    if (key === 'global') out.global = body
    else if (isCssTarget(key)) out.blocks[key] = body
  }
  return out
}

export function removeRegion(overridesCss: string): string {
  const b = regionBounds(overridesCss)
  if (!b) return overridesCss.trimEnd()
  return (overridesCss.slice(0, b.start) + overridesCss.slice(b.end)).trimEnd()
}

export function composeRegion(css: DesignBundle['css']): string {
  const parts: string[] = []
  if (css.global?.trim()) parts.push(`${fragStart('global')}\n${css.global.trim()}\n${fragEnd('global')}`)
  for (const key of CSS_TARGETS) {
    const body = css.blocks[key]?.trim()
    if (body) parts.push(`${fragStart(key)}\n${body}\n${fragEnd(key)}`)
  }
  if (parts.length === 0) return ''
  return `${REGION_BEGIN}\n${parts.join('\n')}\n${REGION_END}\n`
}

export function bundleFromRepoFiles(
  files: RepoThemeFiles,
  meta: { name: string; source: DesignBundle['meta']['source'] }
): { ok: true; bundle: DesignBundle } | { ok: false; errors: string[] } {
  let brand: BrandJson
  let design: DesignJson
  try {
    brand = JSON.parse(files.brandText) as BrandJson
    design = JSON.parse(files.designText) as DesignJson
  } catch {
    return { ok: false, errors: ['brand.json / design.json is not valid JSON.'] }
  }
  const t = normalizeTypography(design.typography)
  return parseDesignBundle({
    schemaVersion: 1,
    name: meta.name,
    palette: brand.palette,
    typography: { headingFont: t.headingFont, bodyFont: t.bodyFont, accentFont: t.accentFont },
    tokens: {
      roundness: design.roundness,
      density: design.density,
      visualFeel: design.visualFeel,
      spacing: design.spacing,
      radius: design.radius,
    },
    treatments: {
      headlineStyle: design.headlineStyle ?? 'sans',
      eyebrowStyle: design.eyebrowStyle ?? 'standard',
      darkSections: design.darkSections ?? false,
    },
    css: readRegion(files.overridesCss),
    meta: { source: meta.source },
  })
}

export function bundleToRepoFiles(
  bundle: DesignBundle,
  current: RepoThemeFiles,
  opts: { removeLegacy: boolean }
): { ok: true; files: RenderedThemeFiles } | { ok: false; errors: string[] } {
  let brand: BrandJson
  let design: DesignJson
  try {
    brand = JSON.parse(current.brandText) as BrandJson
    design = JSON.parse(current.designText) as DesignJson
  } catch {
    return { ok: false, errors: ['brand.json / design.json is not valid JSON.'] }
  }

  // Sanitize every CSS fragment first — nothing is written if any fails.
  const errors: string[] = []
  const clean: DesignBundle['css'] = { blocks: {} }
  if (bundle.css.global?.trim()) {
    const r = sanitizeDesignCss(bundle.css.global, { kind: 'global' })
    if (r.ok) clean.global = r.css
    else errors.push(...r.errors.map((e) => `css.global: ${e}`))
  }
  for (const [key, body] of Object.entries(bundle.css.blocks) as [CssTarget, string | undefined][]) {
    if (!body?.trim()) continue
    const r = sanitizeDesignCss(body, { kind: 'target', target: key })
    if (r.ok) clean.blocks[key] = r.css
    else errors.push(...r.errors.map((e) => `css.blocks.${key}: ${e}`))
  }
  if (errors.length) return { ok: false, errors }

  const nextBrand: BrandJson = { ...brand, palette: { ...brand.palette, ...bundle.palette } }

  const { headingFont, bodyFont, accentFont } = bundle.typography
  const typography = {
    ...design.typography,
    headingFont,
    bodyFont,
    accentFont,
    googleFontsUrl: gfUrl(Array.from(new Set([headingFont, bodyFont, accentFont]))),
  }
  const merged: DesignJson = {
    ...design,
    typography,
    roundness: bundle.tokens.roundness,
    density: bundle.tokens.density,
    visualFeel: bundle.tokens.visualFeel,
    spacing: { ...bundle.tokens.spacing },
    radius: { ...bundle.tokens.radius },
  }
  // Reuse the flag patcher so treatments are omitted-at-default exactly like the
  // Theme Studio controls write them.
  const flagged = patchDesignFlags(serialize(merged), bundle.treatments)
  if (!flagged.ok) return { ok: false, errors: [flagged.reason] }

  const base = (opts.removeLegacy ? MANAGED_HEADER : removeRegion(current.overridesCss)).trimEnd()
  const region = composeRegion(clean)
  const overridesCss = region ? (base ? `${base}\n\n${region}` : region) : base ? `${base}\n` : ''

  return {
    ok: true,
    files: {
      brandText: serialize(nextBrand),
      designText: flagged.next,
      themeCss: generateThemeCss(nextBrand, flagged.design),
      overridesCss,
    },
  }
}
```

- [ ] **Step 4: Run the tests and the type check.**
Run: `npx vitest run lib/design && npx tsc --noEmit`
Expected: PASS.
- The round-trip test asserts `JSON.parse` equality for `brand.json`, not raw text: the golden fixture may be formatted differently.
- If `removeRegion` in the "keeps everything outside the region" test returns the legacy text without its trailing newline, that is the specified behaviour (`trimEnd`).

- [ ] **Step 5: Commit.**

```bash
git add lib/design/bundle-files.ts lib/design/bundle-files.test.ts
git commit -m "feat(design-studio): bundle <-> repo theme files with a managed overrides region

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Extract the MBP theme sync, then apply-bundle-to-draft

**Files:**
- Create: `lib/design/sync-mbp-theme.ts`
- Test: `lib/design/sync-mbp-theme.test.ts`
- Modify: `app/api/edit/[id]/theme/route.ts`:
  - delete the local `paletteSummary`, `typographySummary` and `toPaletteData` (around lines 108–127);
  - replace the MBP-sync block (around lines 202–224) with a `syncMbpTheme` call.
- Create: `lib/design/apply-bundle.ts`
- Test: `lib/design/apply-bundle.test.ts`

**Interfaces:**
- Consumes:
  - `bundleToRepoFiles`, `RepoThemeFiles` (Task 5); `DesignBundle` (Task 4)
  - `readFile`, `writeFiles`, `ensureDraftBranch`, `DRAFT_BRANCH`, `FileNotFoundError` from `lib/github/repo-files.ts`
  - `checkThemeContrast` from `lib/content/theme-css-generator.ts`
  - `updateSessionWithCas` from `lib/session/schema-cas.ts`, `deepSetPath` from `lib/mbp/schema-write.ts`, `asJson`
  - `BRAND_PATH`, `DESIGN_PATH`, `OVERRIDES_PATH`, `THEME_CSS_PATH`, `normalizeTypography` from `@/app/api/edit/[id]/theme/_theme`
- Produces:
  - `paletteSummary(palette: BrandJson['palette']): string`
  - `typographySummary(t: DesignJson['typography']): string`
  - `toPaletteData(palette: BrandJson['palette'], existing: PaletteData | null): PaletteData`
  - `syncMbpTheme(supabase: SupabaseClient<Database>, args: { sessionId: string; jobId: string; brand?: BrandJson; design?: DesignJson }): Promise<void>`. This is best-effort and never throws.
  - `applyBundleToDraft(args: { githubRepo: string; bundle: DesignBundle; removeLegacy: boolean; message: string; author: { name: string; email: string } }): Promise<ApplyBundleResult>`
  - `type ApplyBundleResult = { ok: true; commitSha: string | null; blobs: Record<string, string>; changedPaths: string[]; brand: BrandJson; design: DesignJson } | { ok: false; status: 409 | 422; error: string }`. `StaleShaError` is rethrown for the caller to map to 409.

- [ ] **Step 1: Write the failing test for the sync helpers** in `lib/design/sync-mbp-theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { paletteSummary, typographySummary, toPaletteData } from './sync-mbp-theme'

const palette = {
  primary: '#003b71',
  secondary: '#e8eef5',
  complementary: '#c46a2b',
  action: '#00c1de',
  nearBlack: '#101820',
  nearWhite: '#fafaf7',
}

describe('MBP theme summaries', () => {
  it('summarises the palette in role order', () => {
    expect(paletteSummary(palette)).toBe(
      'primary: #003b71, secondary: #e8eef5, complementary: #c46a2b, action: #00c1de, nearBlack: #101820, nearWhite: #fafaf7'
    )
  })

  it('summarises typography', () => {
    expect(typographySummary({ headingFont: 'Fraunces', bodyFont: 'Public Sans', accentFont: 'Fraunces', googleFontsUrl: 'x' })).toBe(
      'Headings: Fraunces · Body: Public Sans · Accent: Fraunces'
    )
  })

  it('keeps existing swatch names and falls back to the role', () => {
    const out = toPaletteData(palette, { primary: { hex: '#000000', name: 'Harbor Navy' } } as never)
    expect(out.primary).toEqual({ hex: '#003b71', name: 'Harbor Navy' })
    expect(out.action).toEqual({ hex: '#00c1de', name: 'action' })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails.**
Run: `npx vitest run lib/design/sync-mbp-theme.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `lib/design/sync-mbp-theme.ts`.** Move the three helpers verbatim from the theme route and add `syncMbpTheme`:

```ts
// Keep the MBP profile + content_jobs.palette in step with the site's theme
// after a commit to the draft. Shared by the Theme Studio PATCH route and the
// Design Studio apply path. Best-effort: the repo commit already landed, so a
// sync failure is logged, never thrown.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import type { PaletteData } from '@/types/palette'
import { PALETTE_ROLES } from '@/lib/editor/theme-edit'
import { deepSetPath } from '@/lib/mbp/schema-write'
import { asJson } from '@/lib/supabase/json-typed'
import { updateSessionWithCas } from '@/lib/session/schema-cas'
import { normalizeTypography } from '@/app/api/edit/[id]/theme/_theme'

export function paletteSummary(palette: BrandJson['palette']): string {
  return PALETTE_ROLES.map((r) => `${r}: ${palette[r]}`).join(', ')
}

export function typographySummary(t: DesignJson['typography']): string {
  return `Headings: ${t.headingFont} · Body: ${t.bodyFont} · Accent: ${t.accentFont}`
}

// Re-key the structured content_jobs palette from the new hexes, preserving any
// existing swatch names (fall back to the role name).
export function toPaletteData(palette: BrandJson['palette'], existing: PaletteData | null): PaletteData {
  const out = {} as PaletteData
  for (const role of PALETTE_ROLES) {
    out[role] = { hex: palette[role], name: existing?.[role]?.name ?? role }
  }
  return out
}

// Pass `brand` only when the palette changed and `design` only when fonts or
// treatments changed — matching what was actually committed.
export async function syncMbpTheme(
  supabase: SupabaseClient<Database>,
  args: { sessionId: string; jobId: string; brand?: BrandJson; design?: DesignJson }
): Promise<void> {
  const { sessionId, jobId, brand, design } = args
  if (!brand && !design) return
  try {
    await updateSessionWithCas(supabase, sessionId, (session) => {
      let schema = (session.schema_data ?? {}) as Record<string, unknown>
      if (brand) schema = deepSetPath(schema, 'brand.primaryColors', paletteSummary(brand.palette))
      if (design) schema = deepSetPath(schema, 'brand.typography', typographySummary(normalizeTypography(design.typography)))
      return { update: { schema_data: asJson(schema) }, result: null }
    })
  } catch (err) {
    console.warn('[theme] MBP sync failed (theme saved):', err)
  }
  if (brand) {
    try {
      const { data: job } = await supabase.from('content_jobs').select('palette').eq('id', jobId).maybeSingle()
      const nextPalette = toPaletteData(brand.palette, (job?.palette as PaletteData | null) ?? null)
      const { error } = await supabase.from('content_jobs').update({ palette: asJson(nextPalette) }).eq('id', jobId)
      if (error) console.warn('[theme] content_jobs.palette sync failed (theme saved):', error.message)
    } catch (err) {
      console.warn('[theme] content_jobs.palette sync failed (theme saved):', err)
    }
  }
}
```

- [ ] **Step 4: Refactor the theme PATCH route onto it** (`app/api/edit/[id]/theme/route.ts`):
  1. Delete the local `paletteSummary`, `typographySummary` and `toPaletteData` functions and their comments.
  2. Remove the now-unused imports: `deepSetPath`, `asJson`, `PaletteData`, `updateSessionWithCas`, and `PALETTE_ROLES` (if nothing else uses it; run `grep -n "PALETTE_ROLES" "app/api/edit/[id]/theme/route.ts"` to check).
  3. Add `import { syncMbpTheme } from '@/lib/design/sync-mbp-theme'`.
  4. Replace everything from `// MBP sync: keep the profile in step with the site.` down to the end of the `if (brandChanged) { … content_jobs … }` block with:

```ts
    // MBP sync: keep the profile in step with the site (best-effort).
    await syncMbpTheme(createServerClient(), {
      sessionId,
      jobId,
      brand: brandChanged ? brand : undefined,
      design: designChanged ? design : undefined,
    })
```

Behaviour is unchanged apart from one thing: the old `content_jobs` palette update ignored its error, and the new one logs it with `console.warn`.

- [ ] **Step 5: Run the checks.**
Run: `npx vitest run lib/design && npx tsc --noEmit`
Expected: PASS, and tsc exits 0 with no unused-import errors (`npm run lint` catches unused ones).

- [ ] **Step 6: Write the failing apply tests** in `lib/design/apply-bundle.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const files = new Map<string, { content: string; sha: string }>()
const writeFiles = vi.fn()

vi.mock('@/lib/github/repo-files', () => {
  class FileNotFoundError extends Error {}
  return {
    DRAFT_BRANCH: 'draft',
    FileNotFoundError,
    ensureDraftBranch: vi.fn(async () => undefined),
    readFile: vi.fn(async (_repo: string, p: string) => {
      const f = files.get(p)
      if (!f) throw new FileNotFoundError(p)
      return { path: p, ...f }
    }),
    writeFiles: (...args: unknown[]) => writeFiles(...args),
  }
})

import { applyBundleToDraft } from './apply-bundle'
import { VALID } from './__fixtures__/valid-bundle'

const FIX = path.join(__dirname, '..', 'content', '__fixtures__')
const AUTHOR = { name: 'Admin', email: 'a@example.com' }

beforeEach(() => {
  files.clear()
  writeFiles.mockReset()
  writeFiles.mockResolvedValue({ commitSha: 'c1', blobs: { 'content/brand.json': 'b1' } })
  files.set('content/brand.json', { content: readFileSync(path.join(FIX, 'brand.golden.json'), 'utf-8'), sha: 'sb' })
  files.set('content/design.json', { content: readFileSync(path.join(FIX, 'design.golden.json'), 'utf-8'), sha: 'sd' })
})

describe('applyBundleToDraft', () => {
  it('commits every changed theme file in ONE writeFiles call with expected shas', async () => {
    const r = await applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'Design: apply', author: AUTHOR })
    expect(r.ok).toBe(true)
    expect(writeFiles).toHaveBeenCalledTimes(1)
    const [repo, changes, branch, message, opts] = writeFiles.mock.calls[0]
    expect(repo).toBe('o/r')
    expect(branch).toBe('draft')
    expect(message).toBe('Design: apply')
    expect(opts).toEqual({ authorName: 'Admin', authorEmail: 'a@example.com' })
    const byPath = Object.fromEntries((changes as { path: string; expectedSha?: string }[]).map((c) => [c.path, c.expectedSha]))
    expect(byPath['content/brand.json']).toBe('sb')
    expect(byPath['content/design.json']).toBe('sd')
    expect('src/styles/theme.css' in byPath).toBe(true)
    expect(byPath['src/styles/theme.css']).toBeUndefined() // file did not exist
    expect('content/design-overrides.css' in byPath).toBe(true)
    if (r.ok) expect(r.changedPaths).toContain('content/brand.json')
  })

  it('returns 409 when brand.json or design.json is missing', async () => {
    files.delete('content/design.json')
    const r = await applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'm', author: AUTHOR })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(writeFiles).not.toHaveBeenCalled()
  })

  it('returns 422 on a contrast failure without committing', async () => {
    const lowContrast = { ...VALID, palette: { ...VALID.palette, nearBlack: '#fafaf6', nearWhite: '#fafaf7' } }
    const r = await applyBundleToDraft({ githubRepo: 'o/r', bundle: lowContrast, removeLegacy: false, message: 'm', author: AUTHOR })
    expect(r).toMatchObject({ ok: false, status: 422 })
    expect(writeFiles).not.toHaveBeenCalled()
  })

  it('returns 422 when the bundle CSS fails the sanitizer', async () => {
    const bad = { ...VALID, css: { blocks: { hero: 'body { display: none; }' } } }
    const r = await applyBundleToDraft({ githubRepo: 'o/r', bundle: bad, removeLegacy: false, message: 'm', author: AUTHOR })
    expect(r).toMatchObject({ ok: false, status: 422 })
  })

  it('does not commit when nothing changed', async () => {
    const first = await applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'm', author: AUTHOR })
    if (!first.ok) throw new Error('first apply failed')
    // Seed the repo with exactly what the first apply wrote, then re-apply.
    for (const c of writeFiles.mock.calls[0][1] as { path: string; content: string }[]) files.set(c.path, { content: c.content, sha: 'x' })
    writeFiles.mockClear()
    const again = await applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'm', author: AUTHOR })
    expect(again).toMatchObject({ ok: true, commitSha: null, changedPaths: [] })
    expect(writeFiles).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 7: Run them and confirm they fail.**
Run: `npx vitest run lib/design/apply-bundle.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 8: Implement `lib/design/apply-bundle.ts`.**

```ts
// Server-only. Apply a DesignBundle to a client repo's DRAFT branch as ONE
// atomic commit (brand.json, design.json, regenerated theme.css, and the
// managed design-overrides.css region), guarded by expected blob shas so a
// concurrent edit surfaces as StaleShaError (rethrown — callers map it to 409).
// Contrast is a hard gate: nothing is written if the palette fails WCAG checks.
// The MBP mirror is NOT done here — callers invoke syncMbpTheme() after.
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { DRAFT_BRANCH, ensureDraftBranch, readFile, writeFiles, FileNotFoundError } from '@/lib/github/repo-files'
import { checkThemeContrast } from '@/lib/content/theme-css-generator'
import { BRAND_PATH, DESIGN_PATH, OVERRIDES_PATH, THEME_CSS_PATH } from '@/app/api/edit/[id]/theme/_theme'
import { bundleToRepoFiles } from './bundle-files'
import type { DesignBundle } from './bundle'

export type ApplyBundleResult =
  | {
      ok: true
      commitSha: string | null
      blobs: Record<string, string>
      changedPaths: string[]
      brand: BrandJson
      design: DesignJson
    }
  | { ok: false; status: 409 | 422; error: string }

async function readOptional(repo: string, path: string): Promise<{ content: string; sha: string } | null> {
  try {
    const f = await readFile(repo, path, DRAFT_BRANCH)
    return { content: f.content, sha: f.sha }
  } catch (err) {
    if (err instanceof FileNotFoundError) return null
    throw err
  }
}

export async function applyBundleToDraft(args: {
  githubRepo: string
  bundle: DesignBundle
  removeLegacy: boolean
  message: string
  author: { name: string; email: string }
}): Promise<ApplyBundleResult> {
  const { githubRepo, bundle, removeLegacy, message, author } = args
  await ensureDraftBranch(githubRepo)

  const brandFile = await readOptional(githubRepo, BRAND_PATH)
  const designFile = await readOptional(githubRepo, DESIGN_PATH)
  if (!brandFile || !designFile) {
    return { ok: false, status: 409, error: 'This site has no brand.json / design.json yet — design changes are unavailable.' }
  }
  const themeFile = await readOptional(githubRepo, THEME_CSS_PATH)
  const overridesFile = await readOptional(githubRepo, OVERRIDES_PATH)

  const rendered = bundleToRepoFiles(
    bundle,
    { brandText: brandFile.content, designText: designFile.content, overridesCss: overridesFile?.content ?? '' },
    { removeLegacy }
  )
  if (!rendered.ok) return { ok: false, status: 422, error: rendered.errors.join(' ') }

  const brand = JSON.parse(rendered.files.brandText) as BrandJson
  const design = JSON.parse(rendered.files.designText) as DesignJson

  const contrast = checkThemeContrast(brand)
  if (contrast.length > 0) {
    const detail = contrast.map((f) => `${f.name}: ${f.ratio.toFixed(2)}:1 (need ${f.minRatio}:1)`).join('; ')
    return { ok: false, status: 422, error: `The palette fails contrast checks — ${detail}.` }
  }

  const candidates: { path: string; next: string; current: { content: string; sha: string } | null }[] = [
    { path: BRAND_PATH, next: rendered.files.brandText, current: brandFile },
    { path: DESIGN_PATH, next: rendered.files.designText, current: designFile },
    { path: THEME_CSS_PATH, next: rendered.files.themeCss, current: themeFile },
    { path: OVERRIDES_PATH, next: rendered.files.overridesCss, current: overridesFile },
  ]
  const changes = candidates
    .filter((c) => c.next !== (c.current?.content ?? null))
    // An absent overrides file that would stay empty is not a change.
    .filter((c) => !(c.current === null && c.next === ''))
    .map((c) => ({ path: c.path, content: c.next, expectedSha: c.current?.sha || undefined }))

  if (changes.length === 0) {
    return { ok: true, commitSha: null, blobs: {}, changedPaths: [], brand, design }
  }

  const { commitSha, blobs } = await writeFiles(githubRepo, changes, DRAFT_BRANCH, message, {
    authorName: author.name,
    authorEmail: author.email,
  })
  return { ok: true, commitSha, blobs, changedPaths: changes.map((c) => c.path), brand, design }
}
```

- [ ] **Step 9: Run the full verification.**

```bash
npx vitest run lib/design lib/theme-preview lib/content/token-pricing.test.ts lib/content/theme-css-generator.test.ts lib/editor
npx tsc --noEmit
npm run lint
npm test
npm run build
grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app
grep -r "GITHUB_APP_PRIVATE_KEY" ./app
grep -rn "console\.log" ./app ./lib --include="*.ts" --include="*.tsx" --exclude="*.test.ts" --exclude="*.test.tsx"
```

Expected: all tests pass (the full suite is still green), tsc and lint exit 0, the build succeeds, and all three greps return zero matches. If the contrast-failure test passes a palette that `checkThemeContrast` does not flag, make `nearBlack` equal to `nearWhite` in that test only.

- [ ] **Step 10: Commit.**

```bash
git add lib/design/sync-mbp-theme.ts lib/design/sync-mbp-theme.test.ts lib/design/apply-bundle.ts lib/design/apply-bundle.test.ts "app/api/edit/[id]/theme/route.ts"
git commit -m "feat(design-studio): atomic apply-bundle-to-draft + extracted MBP theme sync

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Manual check (end of P0)

1. Run `npm run dev`, sign in as an admin, and open a content-ready client's editor, then **Theme & styling**.
2. Toggle **Headline style → Serif** and **Eyebrow → Mono**. The preview's headings and eyebrows change straight away. This works only if the deployed site has the 09-08 treatments template, as bblcpa does.
3. In the theme chat, ask "make the hero headline letter-spacing tighter". The rule commits.
4. Ask "hide the FAQ section". The tool returns `CSS rejected: display: none is not allowed…` and the assistant explains why.
5. Change a palette swatch. The MBP `brand.primaryColors` updates as before (this checks the extracted sync).

## Out of scope for P0 (later phases)

- Renderer / screenshots (P1)
- Tables, inputs and versions (P2)
- Brief and concept generation (P3)
- Critique (P4)
- Revision chat (P5)
- Template fonts module and axes (T1/T2, P6)
- Rollout (T3)
- A/B and retirement (P7)
