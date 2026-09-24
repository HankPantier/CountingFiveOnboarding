# Design Studio P1 — Renderer Spike + Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the platform eyes. P1 makes these three things possible:
- **Render a composed Theme Studio page to screenshots:** the client's real deployed page plus the draft theme CSS, rendered in headless Chromium on Vercel.
- **Capture screenshots of external sites** (inspiration, competitor, current site) through ScrapingBee.
- **Prove the renderer on a Vercel preview deploy.** The go/no-go gate is a warm p95 under 5 s per render, with no out-of-memory errors.

**Architecture:**
- **Pure pieces** (URL/path resolution, render hardening, page picking) are unit-tested without a browser.
- **The server-only renderer** (`lib/design/render/*`) uses `playwright-core`:
  - on Vercel it launches `@sparticuz/chromium`;
  - locally it launches the Chromium at `CHROMIUM_EXECUTABLE_PATH`.
- **One admin-only route, `POST /api/edit/[id]/design/render`,** composes, renders, stores WebP screenshots in the private bucket, and returns signed URLs.
- **External URLs never touch our browser.** They go to the ScrapingBee screenshot API.
- **No UI, no tables.** Those arrive in P2.

**Tech Stack:** Next.js 16.3.5 (App Router, Node runtime), TypeScript strict, vitest, playwright-core 1.63.0, @sparticuz/chromium 153.0.0, sharp 0.35, file-type 22, Supabase Storage, ScrapingBee.

**Spec:** `docs/superpowers/specs/2026-09-24-design-studio-design.md`. Read §Architecture (Renderer, External capture), §Safety and validation, and §Phased delivery → P1.

## Global Constraints

- **Access:**
  - Admin-only. Every new `app/api/edit/[id]/design/**` route starts with `requireDesignAdmin(id)` (Task 2), which is `resolveEditContext` followed by `ctx.user.isAdmin`, otherwise 403.
  - Existing gates stay unchanged.
- **Storage:**
  - The `session-assets` bucket is private.
  - Design images go under `design/{sessionId}/…`, WebP only.
  - Use signed URLs only, with a TTL of 3600.
  - Never call `.getPublicUrl()`. Never write to the `assets` table from design code.
- **URLs:**
  - A page path that comes from the client is decoded and normalized BEFORE any check, and the resolved URL must be same-origin with the site (CLAUDE.md security rule 8).
  - External URLs must pass `isUrlPubliclyFetchable` before they are sent to ScrapingBee.
- **Renderer isolation:**
  - The browser only loads the shell's own origin, `fonts.googleapis.com`, `fonts.gstatic.com`, and `data:` URLs.
  - Scripts are stripped, and a CSP meta tag blocks scripts, connections, frames and objects.
  - External sites are never loaded in our browser.
- **Errors and logging:**
  - 5xx responses use `internalError(context, err, publicMessage)` from `lib/api/errors.ts`.
  - Deliberate 4xx responses keep their messages.
  - No `console.log`: use `console.warn` / `console.error`.
- **Types and client/server boundary:**
  - No `as any`.
  - Nothing in `lib/design/render/**`, `lib/design/capture/**` or `lib/design/storage.ts` may be imported by a `'use client'` file.
- **Native packages:**
  - `@sparticuz/chromium` and `playwright-core` go in `serverExternalPackages`.
  - The render route gets `outputFileTracingIncludes` for `./node_modules/@sparticuz/chromium/bin/**`.
- **Checks:**
  - After each task: `npx tsc --noEmit` is clean and `npm run lint` is clean.
  - Before each commit: the three CLAUDE.md greps return zero matches (service role key and GitHub key in `./app`; `console.log` in `./app` and `./lib`, excluding tests).
- **Commits:** end every commit message with a `Co-Authored-By:` line naming the model that wrote it.
- **Branch:** create `feat/design-studio-p1` from `master` (fcdf0fb) before Task 1.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `lib/theme-preview/page-path.ts` | create | `resolvePreviewPageUrl()`: decode, normalize and same-origin check a page path |
| `lib/theme-preview/page-path.test.ts` | create | |
| `lib/theme-preview/site-url.ts` | create | `getPreviewSiteUrl()`: `content_jobs.preview_url`, falling back to site.config on main (extracted from the shell route) |
| `app/api/edit/[id]/theme/shell/route.ts` | modify | Use both helpers; accept `?path=` |
| `app/api/edit/[id]/design/_design.ts` | create | `requireDesignAdmin()` |
| `lib/design/pages.ts` | create | `pickRepresentativePages()` (pure) |
| `lib/design/pages.test.ts` | create | |
| `app/api/edit/[id]/design/pages/route.ts` | create | GET the candidate and picked preview pages |
| `lib/design/theme-sources.ts` | create | `loadDraftThemeSources()` (extracted from the theme GET route) |
| `app/api/edit/[id]/theme/route.ts` | modify | GET uses `loadDraftThemeSources()` |
| `lib/design/render/harden.ts` | create | Pure: CSP, lazy→eager, request allowlist, viewports, crop list, caps |
| `lib/design/render/harden.test.ts` | create | |
| `lib/design/render/browser.ts` | create | `getBrowser()` (warm reuse), `RendererUnavailableError` |
| `lib/design/render/render-composed.ts` | create | `renderComposed()` |
| `lib/design/render/render-composed.test.ts` | create | Real-browser integration test, skipped without `CHROMIUM_EXECUTABLE_PATH` |
| `lib/design/storage.ts` | create | `toWebp`, `designStoragePath`, `storeDesignImage`, `signDesignPaths` |
| `lib/design/storage.test.ts` | create | |
| `lib/design/capture/external.ts` | create | `captureExternalScreenshot()` via ScrapingBee |
| `lib/design/capture/external.test.ts` | create | |
| `app/api/edit/[id]/design/render/route.ts` | create | POST render, store, sign |
| `app/api/edit/[id]/design/render/route.test.ts` | create | |
| `next.config.ts`, `vercel.json`, `package.json`, `.env.example`, `CLAUDE.md` | modify | Packages, tracing, function memory and duration, env docs, storage prefix |
| `docs/superpowers/specs/2026-09-24-design-studio-p1-gate.md` | create | Go/no-go measurement record |

---

### Task 1: Page-path resolution and `?path=` on the preview shell

**Files:**
- Create: `lib/theme-preview/page-path.ts`, `lib/theme-preview/page-path.test.ts`, `lib/theme-preview/site-url.ts`
- Modify: `app/api/edit/[id]/theme/shell/route.ts`

**Interfaces:**
- Produces:
  - `resolvePreviewPageUrl(siteUrl: string, rawPath: string | null | undefined): { ok: true; url: string; path: string } | { ok: false; reason: string }`
  - `getPreviewSiteUrl(args: { jobId: string; githubRepo: string }): Promise<string | null>`

- [ ] **Step 1: Create the branch.**

```bash
git checkout master && git pull --ff-only && git checkout -b feat/design-studio-p1
```

- [ ] **Step 2: Write the failing tests** in `lib/theme-preview/page-path.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolvePreviewPageUrl } from './page-path'

const SITE = 'https://bblcpa.vercel.app/'

describe('resolvePreviewPageUrl', () => {
  it('defaults to the site root', () => {
    expect(resolvePreviewPageUrl(SITE, null)).toEqual({ ok: true, url: 'https://bblcpa.vercel.app/', path: '/' })
    expect(resolvePreviewPageUrl(SITE, '')).toEqual({ ok: true, url: 'https://bblcpa.vercel.app/', path: '/' })
  })

  it('resolves a normal page path on the same origin', () => {
    expect(resolvePreviewPageUrl(SITE, '/services/tax')).toEqual({
      ok: true,
      url: 'https://bblcpa.vercel.app/services/tax',
      path: '/services/tax',
    })
  })

  it('decodes before validating', () => {
    expect(resolvePreviewPageUrl(SITE, '%2Fabout')).toEqual({ ok: true, url: 'https://bblcpa.vercel.app/about', path: '/about' })
  })

  it.each([
    ['no leading slash', 'about'],
    ['protocol-relative', '//evil.test/x'],
    ['encoded protocol-relative', '%2F%2Fevil.test'],
    ['absolute url', 'https://evil.test/'],
    ['backslash', '/\\evil.test'],
    ['traversal', '/a/../../etc/passwd'],
    ['encoded traversal', '/a/%2E%2E/%2E%2E/x'],
    ['dot segment', '/./x'],
    ['bad encoding', '/%E0%A4%A'],
    ['query string', '/x?y=1'],
    ['fragment', '/x#y'],
    ['too long', '/' + 'a'.repeat(300)],
  ])('rejects %s', (_label, raw) => {
    expect(resolvePreviewPageUrl(SITE, raw).ok).toBe(false)
  })

  it('rejects an unparseable site url', () => {
    expect(resolvePreviewPageUrl('not a url', '/').ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run them and confirm they fail.**
Run: `npx vitest run lib/theme-preview/page-path.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 4: Implement `lib/theme-preview/page-path.ts`.**

```ts
// Resolve a client-supplied page path (e.g. "/services/tax") against the
// client's deployed site URL for the preview shell / renderer. Decode FIRST,
// then validate (CLAUDE.md security rule 8): a raw startsWith('/') check passes
// "%2F%2Fevil.test" until something downstream decodes it. The result must stay
// on the site's own origin — this feeds a server-side fetch.
const MAX_PATH_LENGTH = 200

export function resolvePreviewPageUrl(
  siteUrl: string,
  rawPath: string | null | undefined
): { ok: true; url: string; path: string } | { ok: false; reason: string } {
  let base: URL
  try {
    base = new URL(siteUrl)
  } catch {
    return { ok: false, reason: 'The site URL is invalid.' }
  }
  if (rawPath == null || rawPath === '') return { ok: true, url: new URL('/', base).toString(), path: '/' }

  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return { ok: false, reason: 'The page path is not valid URL encoding.' }
  }
  if (decoded.length > MAX_PATH_LENGTH) return { ok: false, reason: 'The page path is too long.' }
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return { ok: false, reason: 'The page path must start with a single "/".' }
  if (/[\\?#]/.test(decoded)) return { ok: false, reason: 'The page path may not contain "\\", "?" or "#".' }
  const segments = decoded.split('/').slice(1)
  if (segments.some((s, i) => s === '.' || s === '..' || (s === '' && i < segments.length - 1))) {
    return { ok: false, reason: 'The page path may not contain empty or dot segments.' }
  }

  let resolved: URL
  try {
    resolved = new URL(decoded, base)
  } catch {
    return { ok: false, reason: 'The page path is invalid.' }
  }
  if (resolved.origin !== base.origin) return { ok: false, reason: 'The page path must stay on the site.' }
  return { ok: true, url: resolved.toString(), path: resolved.pathname }
}
```

- [ ] **Step 5: Run the tests.**
Run: `npx vitest run lib/theme-preview/page-path.test.ts`
Expected: PASS.

- [ ] **Step 6: Extract the site-URL lookup.** Create `lib/theme-preview/site-url.ts`:

```ts
// Server-only. The URL the Theme Studio preview / Design Studio renderer
// fetches: the operator's content_jobs.preview_url override (e.g. a Vercel
// preview before DNS cutover), else the canonical site.config.ts siteUrl on
// MAIN. Never client input.
import { createServerClient } from '@/lib/supabase/server'
import { MAIN_BRANCH, readSiteConfigSiteUrl } from '@/lib/github/repo-files'

export async function getPreviewSiteUrl(args: { jobId: string; githubRepo: string }): Promise<string | null> {
  const supabase = createServerClient()
  const { data: job } = await supabase.from('content_jobs').select('preview_url').eq('id', args.jobId).single()
  return job?.preview_url ?? (await readSiteConfigSiteUrl(args.githubRepo, MAIN_BRANCH))
}
```

- [ ] **Step 7: Update the shell route.** Replace the body of `GET` in `app/api/edit/[id]/theme/shell/route.ts` after the admin check with:

```ts
  const siteUrl = await getPreviewSiteUrl({ jobId: ctx.jobId, githubRepo })
  if (!siteUrl) {
    return NextResponse.json(
      { error: 'No preview URL is set for this client. Add one above to preview the site.' },
      { status: 409 }
    )
  }

  // Optional ?path= previews another page of the same site (Design Studio
  // multi-page preview). Decoded + same-origin checked before any fetch.
  const page = resolvePreviewPageUrl(siteUrl, new URL(req.url).searchParams.get('path'))
  if (!page.ok) return NextResponse.json({ error: page.reason }, { status: 400 })

  const shell = await buildPreviewShell(page.url)
  if (!shell.ok) {
    return NextResponse.json({ error: shell.reason }, { status: 502 })
  }
  return NextResponse.json({ origin: shell.origin, shellHtml: shell.shellHtml, path: page.path })
```

Then update the imports:
1. Remove `createServerClient` and the `MAIN_BRANCH, readSiteConfigSiteUrl` import.
2. Add:
   ```ts
   import { getPreviewSiteUrl } from '@/lib/theme-preview/site-url'
   import { resolvePreviewPageUrl } from '@/lib/theme-preview/page-path'
   ```

The response gains a `path` field. Existing callers ignore unknown fields, so this is backward-compatible.

- [ ] **Step 8: Run the checks.**
Run: `npx vitest run lib/theme-preview && npx tsc --noEmit && npm run lint`
Expected: PASS and clean.

- [ ] **Step 9: Commit.**

```bash
git add lib/theme-preview/page-path.ts lib/theme-preview/page-path.test.ts lib/theme-preview/site-url.ts "app/api/edit/[id]/theme/shell/route.ts"
git commit -m "feat(design-studio): multi-page preview shell (?path=) with decode-then-same-origin validation"
```

---

### Task 2: Design admin gate, representative pages, and the pages route

**Files:**
- Create: `app/api/edit/[id]/design/_design.ts`, `lib/design/pages.ts`, `lib/design/pages.test.ts`, `app/api/edit/[id]/design/pages/route.ts`

**Interfaces:**
- Consumes: `resolveEditContext`, `EditContext` from `app/api/edit/[id]/_helpers.ts`; `listTree(slug, branch, prefix?)` and `DRAFT_BRANCH` from `lib/github/repo-files.ts`; `contentPathToUrl(path)` from `lib/editor/content-paths.ts`.
- Produces:
  - `requireDesignAdmin(id: string): Promise<EditContext | NextResponse>`
  - `type PreviewPage = { key: 'home' | 'service' | 'about' | 'contact'; path: string }`
  - `pickRepresentativePages(contentPaths: string[]): { picks: PreviewPage[]; pages: string[] }`

- [ ] **Step 1: Write the failing tests** in `lib/design/pages.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickRepresentativePages } from './pages'

const TREE = [
  'content/pages/home.md',
  'content/pages/services.md',
  'content/pages/services--tax-planning.md',
  'content/pages/services--bookkeeping.md',
  'content/pages/who-we-are.md',
  'content/pages/contact-us.md',
  'content/pages/industries--construction.md',
  'content/drafts/pages/secret.md',
  'content/posts/some-post.md',
  'content/brand.json',
]

describe('pickRepresentativePages', () => {
  it('picks home, a deep service page, about and contact in that order', () => {
    const r = pickRepresentativePages(TREE)
    expect(r.picks).toEqual([
      { key: 'home', path: '/' },
      { key: 'service', path: '/services/bookkeeping' },
      { key: 'about', path: '/who-we-are' },
      { key: 'contact', path: '/contact-us' },
    ])
  })

  it('lists only live pages, sorted, excluding drafts and posts', () => {
    expect(pickRepresentativePages(TREE).pages).toEqual([
      '/',
      '/contact-us',
      '/industries/construction',
      '/services',
      '/services/bookkeeping',
      '/services/tax-planning',
      '/who-we-are',
    ])
  })

  it('falls back to /services and skips missing roles', () => {
    const r = pickRepresentativePages(['content/pages/home.md', 'content/pages/services.md'])
    expect(r.picks).toEqual([
      { key: 'home', path: '/' },
      { key: 'service', path: '/services' },
    ])
  })

  it('always includes home even when the tree lacks it', () => {
    expect(pickRepresentativePages([]).picks).toEqual([{ key: 'home', path: '/' }])
  })

  it('matches about-style pages: about, about-us, team, our-team', () => {
    for (const slug of ['about', 'about-us', 'team', 'our-team', 'our-firm']) {
      const r = pickRepresentativePages([`content/pages/${slug}.md`])
      expect(r.picks.find((p) => p.key === 'about')?.path).toBe(`/${slug}`)
    }
  })
})
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `npx vitest run lib/design/pages.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `lib/design/pages.ts`.**

```ts
// Pure: choose which of a client's live pages the Design Studio previews and
// renders by default (ported from the retired export-brief's
// pickRepresentativePages). Home is always first; then one service page
// (prefer a deep /services/* page — it carries the richest blocks), an
// about/team page, and contact. Missing roles are skipped.
import { contentPathToUrl } from '@/lib/editor/content-paths'

export type PreviewPage = { key: 'home' | 'service' | 'about' | 'contact'; path: string }

const ABOUT_RE = /^\/(about|about-us|who-we-are|our-firm|our-story|team|our-team)$/
const CONTACT_RE = /^\/contact(-us)?$/

export function pickRepresentativePages(contentPaths: string[]): { picks: PreviewPage[]; pages: string[] } {
  const pages = Array.from(
    new Set(
      contentPaths
        .filter((p) => /^content\/pages\/[^/]+\.md$/.test(p))
        .map((p) => contentPathToUrl(p))
        .filter((u): u is string => typeof u === 'string')
    )
  ).sort()

  const picks: PreviewPage[] = [{ key: 'home', path: '/' }]
  const deepService = pages.find((u) => u.startsWith('/services/'))
  const service = deepService ?? pages.find((u) => u === '/services')
  if (service) picks.push({ key: 'service', path: service })
  const about = pages.find((u) => ABOUT_RE.test(u))
  if (about) picks.push({ key: 'about', path: about })
  const contact = pages.find((u) => CONTACT_RE.test(u))
  if (contact) picks.push({ key: 'contact', path: contact })
  return { picks, pages }
}
```

Note: the sorted order puts `/services/bookkeeping` before `/services/tax-planning`, which is what the first test expects.

- [ ] **Step 4: Run the tests.**
Run: `npx vitest run lib/design/pages.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the gate** `app/api/edit/[id]/design/_design.ts`:

```ts
// Every Design Studio route is admin-only (spec: "FOR NOW: ONLY ADMINS").
// resolveEditContext gives UUID validation, session access, phase ≥ 6 and a
// provisioned repo; the admin check narrows it to the admin tier.
import { NextResponse } from 'next/server'
import { resolveEditContext, type EditContext } from '../_helpers'

export async function requireDesignAdmin(id: string): Promise<EditContext | NextResponse> {
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return ctx
}
```

- [ ] **Step 6: Create the route** `app/api/edit/[id]/design/pages/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { DRAFT_BRANCH, listTree } from '@/lib/github/repo-files'
import { pickRepresentativePages } from '@/lib/design/pages'
import { requireDesignAdmin } from '../_design'

export const runtime = 'nodejs'

// GET the client's live pages + the default preview picks for the Design
// Studio page picker. Admin-only. Read from DRAFT (what the next build ships).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  try {
    const tree = await listTree(ctx.githubRepo, DRAFT_BRANCH, 'content/pages/')
    const paths = tree.filter((e) => e.type === 'blob').map((e) => e.path)
    return NextResponse.json(pickRepresentativePages(paths))
  } catch (err) {
    return internalError('design:pages', err, 'Failed to list the site pages')
  }
}
```

- [ ] **Step 7: Run the checks.**
Run: `npx vitest run lib/design && npx tsc --noEmit && npm run lint`
Expected: PASS and clean.

- [ ] **Step 8: Commit.**

```bash
git add "app/api/edit/[id]/design/_design.ts" "app/api/edit/[id]/design/pages/route.ts" lib/design/pages.ts lib/design/pages.test.ts
git commit -m "feat(design-studio): admin gate + representative preview pages route"
```

---

### Task 3: Render hardening (pure) and the draft theme-sources loader

**Files:**
- Create: `lib/design/render/harden.ts`, `lib/design/render/harden.test.ts`, `lib/design/theme-sources.ts`
- Modify: `app/api/edit/[id]/theme/route.ts` (the GET handler uses `loadDraftThemeSources`)

**Interfaces:**
- Produces (`harden.ts`, pure):
  - `RENDER_CSP: string`
  - `hardenForRender(html: string): string`
  - `isAllowedRenderRequest(url: string, shellOrigin: string): boolean`
  - `VIEWPORTS: { desktop: { width: 1440; height: 900; deviceScaleFactor: 1 }; mobile: { width: 390; height: 844; deviceScaleFactor: 2 } }`
  - `type ViewportKey = 'desktop' | 'mobile'`
  - `CROP_SELECTORS: readonly string[]`
  - `MAX_RENDER_REQUESTS = 60`, `PAGE_TIMEOUT_MS = 20_000`
- Produces (`theme-sources.ts`, server-only):
  - `loadDraftThemeSources(githubRepo: string): Promise<{ ok: true; sources: ThemeSources } | { ok: false; status: 409 | 422; error: string }>`
  - `ThemeSources` comes from `app/api/edit/[id]/theme/_theme.ts`.

- [ ] **Step 1: Write the failing tests** in `lib/design/render/harden.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hardenForRender, isAllowedRenderRequest, RENDER_CSP, VIEWPORTS, CROP_SELECTORS } from './harden'

const ORIGIN = 'https://bblcpa.vercel.app/'

describe('hardenForRender', () => {
  const html = `<!doctype html><html><head><title>x</title><script>alert(1)</script></head><body><img loading="lazy" src="/a.jpg"><iframe loading='lazy'></iframe><script src="/b.js"></script></body></html>`
  const out = hardenForRender(html)

  it('injects the CSP meta as the first thing in <head>', () => {
    expect(out).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">`)
  })
  it('strips scripts', () => {
    expect(out).not.toMatch(/<script/i)
  })
  it('makes lazy media eager so screenshots are complete', () => {
    expect(out).not.toMatch(/loading=["']?lazy/i)
    expect(out).toContain('loading="eager"')
  })
  it('CSP blocks scripts, connections, frames and objects', () => {
    for (const d of ["script-src 'none'", "connect-src 'none'", "frame-src 'none'", "object-src 'none'"]) expect(RENDER_CSP).toContain(d)
  })
})

describe('isAllowedRenderRequest', () => {
  it.each([
    ['same origin asset', 'https://bblcpa.vercel.app/_next/static/css/app.css', true],
    ['google fonts css', 'https://fonts.googleapis.com/css2?family=Inter', true],
    ['google fonts file', 'https://fonts.gstatic.com/s/inter/v1/x.woff2', true],
    ['data uri', 'data:image/svg+xml,%3Csvg/%3E', true],
    ['other origin', 'https://evil.test/x.png', false],
    ['http downgrade of same host', 'http://bblcpa.vercel.app/x.css', false],
    ['lookalike host', 'https://bblcpa.vercel.app.evil.test/x', false],
    ['fonts over http', 'http://fonts.gstatic.com/x.woff2', false],
    ['blob', 'blob:https://bblcpa.vercel.app/123', false],
    ['garbage', 'not a url', false],
  ])('%s', (_l, url, expected) => {
    expect(isAllowedRenderRequest(url, ORIGIN)).toBe(expected)
  })
})

describe('render constants', () => {
  it('uses the spec viewports', () => {
    expect(VIEWPORTS.desktop).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 })
    expect(VIEWPORTS.mobile).toEqual({ width: 390, height: 844, deviceScaleFactor: 2 })
  })
  it('crops blocks in priority order and never the hero (it is in the fold shot)', () => {
    expect(CROP_SELECTORS[0]).toContain('feature-grid')
    expect(CROP_SELECTORS.join(' ')).not.toContain('"hero"')
  })
})
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `npx vitest run lib/design/render/harden.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `lib/design/render/harden.ts`.**

```ts
// Pure render hardening for the Design Studio's headless renderer. The composed
// document is the client's own deployed page (scripts already stripped by
// transformShellHtml) + our injected theme CSS; we still defend in depth:
// strip scripts again, pin a restrictive CSP, and only let the browser fetch
// the shell's own origin, Google Fonts, and data: URIs.

export const RENDER_CSP = "script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'"

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2 },
} as const
export type ViewportKey = keyof typeof VIEWPORTS

// Block crops in priority order (desktop only). The hero is always in the
// above-the-fold shot, so it's never cropped separately. Each entry may match
// several blocks; the renderer takes the first match per entry.
export const CROP_SELECTORS: readonly string[] = [
  '[data-block="feature-grid"], [data-block="service-cards"]',
  '[data-block="content-split"]',
  '[data-block="cta-banner"], [data-block="industry-cards"]',
  '[data-component="footer"]',
]

export const MAX_RENDER_REQUESTS = 60
export const PAGE_TIMEOUT_MS = 20_000

const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])

export function hardenForRender(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/\bloading\s*=\s*(["']?)lazy\1/gi, 'loading="eager"')
    .replace(/<head([^>]*)>/i, (_m, attrs: string) => `<head${attrs}><meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">`)
}

export function isAllowedRenderRequest(url: string, shellOrigin: string): boolean {
  if (url.startsWith('data:')) return true
  let u: URL
  let shell: URL
  try {
    u = new URL(url)
    shell = new URL(shellOrigin)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  if (u.origin === shell.origin) return true
  return FONT_HOSTS.has(u.hostname)
}
```

- [ ] **Step 4: Run the tests.**
Run: `npx vitest run lib/design/render/harden.test.ts`
Expected: PASS.

- [ ] **Step 5: Extract `loadDraftThemeSources`.** Create `lib/design/theme-sources.ts` by moving the GET logic out of `app/api/edit/[id]/theme/route.ts` (the part after `ensureDraftBranch`, which builds `sources`):

```ts
// Server-only. Read a client site's current theme sources from the DRAFT
// branch — shared by the Theme Studio GET route and the Design Studio renderer
// (which composes the draft theme onto the live page shell).
import { DRAFT_BRANCH, ensureDraftBranch, readFile, FileNotFoundError } from '@/lib/github/repo-files'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import {
  BRAND_PATH,
  DESIGN_PATH,
  OVERRIDES_PATH,
  THEME_CSS_PATH,
  normalizeTypography,
  type ThemeSources,
} from '@/app/api/edit/[id]/theme/_theme'

async function readOr(githubRepo: string, path: string, fallback: string): Promise<string> {
  try {
    return (await readFile(githubRepo, path, DRAFT_BRANCH)).content
  } catch (err) {
    if (err instanceof FileNotFoundError) return fallback
    throw err
  }
}

export async function loadDraftThemeSources(
  githubRepo: string
): Promise<{ ok: true; sources: ThemeSources } | { ok: false; status: 409 | 422; error: string }> {
  await ensureDraftBranch(githubRepo)
  const brandText = await readOr(githubRepo, BRAND_PATH, '')
  const designText = await readOr(githubRepo, DESIGN_PATH, '')
  if (!brandText || !designText) {
    return { ok: false, status: 409, error: 'This site has no brand.json / design.json yet — theme editing is unavailable.' }
  }
  let brand: BrandJson
  let design: DesignJson
  try {
    brand = JSON.parse(brandText) as BrandJson
    design = JSON.parse(designText) as DesignJson
  } catch {
    return { ok: false, status: 422, error: 'brand.json / design.json is not valid JSON.' }
  }
  const themeCss = await readOr(githubRepo, THEME_CSS_PATH, '')
  const overridesCss = await readOr(githubRepo, OVERRIDES_PATH, '')
  return {
    ok: true,
    sources: {
      palette: brand.palette,
      typography: normalizeTypography(design.typography),
      roundness: design.roundness,
      density: design.density,
      visualFeel: design.visualFeel,
      headlineStyle: design.headlineStyle ?? 'sans',
      eyebrowStyle: design.eyebrowStyle ?? 'standard',
      darkSections: design.darkSections ?? false,
      spacing: design.spacing,
      radius: design.radius,
      themeCss,
      overridesCss,
    },
  }
}
```

Then replace the GET handler's `try` body in `app/api/edit/[id]/theme/route.ts` with:

```ts
  try {
    const loaded = await loadDraftThemeSources(githubRepo)
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    return NextResponse.json(loaded.sources)
  } catch (err) {
    return internalError('theme:get', err, 'Failed to load theme sources')
  }
```

Also:
- Delete the route's local `readOr` only if PATCH no longer uses it (PATCH uses its own `load`, so check with `grep -n "readOr" "app/api/edit/[id]/theme/route.ts"`).
- Remove imports that are now unused.
- The GET response body must be byte-for-byte the same shape as before.

- [ ] **Step 6: Run the checks.**
Run: `npx vitest run lib/design lib/theme-preview && npx tsc --noEmit && npm run lint`
Expected: PASS and clean.

- [ ] **Step 7: Commit.**

```bash
git add lib/design/render/harden.ts lib/design/render/harden.test.ts lib/design/theme-sources.ts "app/api/edit/[id]/theme/route.ts"
git commit -m "feat(design-studio): render hardening + shared draft theme-sources loader"
```

---

### Task 4: Headless renderer (`browser.ts` + `render-composed.ts`)

**Files:**
- Modify: `package.json` (add `playwright-core@1.63.0`, `@sparticuz/chromium@153.0.0` as exact dependencies), `.env.example`
- Create: `lib/design/render/browser.ts`, `lib/design/render/render-composed.ts`, `lib/design/render/render-composed.test.ts`

**Interfaces:**
- Consumes: everything from `harden.ts` (Task 3).
- Produces:
  - `class RendererUnavailableError extends Error`
  - `getBrowser(): Promise<Browser>`, with `Browser` from `playwright-core`
  - `type RenderShot = { kind: 'fold' | 'next' | 'block'; selector?: string; png: Buffer }`
  - `type RenderResult = { shots: RenderShot[]; timings: { launchMs: number; renderMs: number }; blockedRequests: number }`
  - `renderComposed(args: { html: string; shellOrigin: string; viewport: ViewportKey; crops?: boolean }): Promise<RenderResult>`

- [ ] **Step 1: Install the packages.**

```bash
npm install --save-exact playwright-core@1.63.0 @sparticuz/chromium@153.0.0
```

What to expect:
- An `EBADENGINE` **warning** for `@sparticuz/chromium` on local Node 22.16 is fine; it needs ≥ 22.17, and Vercel runs Node 24. It is never executed locally.
- The install must not fail. If `npm config get engine-strict` is `true`, stop and report.

- [ ] **Step 2: Document local rendering.** Append to `.env.example`:

```bash
# Design Studio renderer (local dev only). Point at a local Chrome/Chromium; on
# Vercel the renderer uses @sparticuz/chromium automatically.
# macOS: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
CHROMIUM_EXECUTABLE_PATH=
```

- [ ] **Step 3: Write the integration test first.** It is skipped unless a local Chromium is configured. Create `lib/design/render/render-composed.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { renderComposed } from './render-composed'
import { closeBrowserForTests } from './browser'

const HAS_CHROME = !!process.env.CHROMIUM_EXECUTABLE_PATH
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

const HTML = `<!doctype html><html><head><base href="https://example.invalid/"></head><body style="margin:0">
<section data-block="hero" style="height:900px;background:#003b71;color:#fff"><h1>Hero</h1></section>
<section data-block="feature-grid" style="height:400px;background:#eee">Features</section>
<section data-block="cta-banner" style="height:300px;background:#f57f09">CTA</section>
<footer data-component="footer" style="height:200px;background:#222">Footer</footer>
<img src="https://evil.test/track.png" alt="">
</body></html>`

describe.skipIf(!HAS_CHROME)('renderComposed (real Chromium)', () => {
  afterAll(async () => {
    await closeBrowserForTests()
  })

  it('renders the desktop fold plus block crops as PNGs and blocks foreign requests', async () => {
    const r = await renderComposed({ html: HTML, shellOrigin: 'https://example.invalid/', viewport: 'desktop', crops: true })
    const kinds = r.shots.map((s) => s.kind)
    expect(kinds[0]).toBe('fold')
    expect(kinds.filter((k) => k === 'block').length).toBeGreaterThanOrEqual(2)
    for (const s of r.shots) expect(s.png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true)
    expect(r.blockedRequests).toBeGreaterThanOrEqual(1)
    expect(r.timings.renderMs).toBeGreaterThan(0)
  }, 60_000)

  it('renders mobile fold + next viewport and no block crops', async () => {
    const r = await renderComposed({ html: HTML, shellOrigin: 'https://example.invalid/', viewport: 'mobile' })
    expect(r.shots.map((s) => s.kind)).toEqual(['fold', 'next'])
  }, 60_000)

  it('reuses the warm browser (second launch is near-instant)', async () => {
    const r = await renderComposed({ html: HTML, shellOrigin: 'https://example.invalid/', viewport: 'mobile' })
    expect(r.timings.launchMs).toBeLessThan(200)
  }, 60_000)
})

describe('renderComposed without a browser', () => {
  it.skipIf(HAS_CHROME)('throws RendererUnavailableError when no Chromium is configured', async () => {
    await expect(renderComposed({ html: HTML, shellOrigin: 'https://example.invalid/', viewport: 'mobile' })).rejects.toThrow(
      /CHROMIUM_EXECUTABLE_PATH/
    )
  })
})
```

- [ ] **Step 4: Run it and confirm it fails.**

```bash
CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npx vitest run lib/design/render/render-composed.test.ts
```

Expected: FAIL, because the module is not found.

- [ ] **Step 5: Implement `lib/design/render/browser.ts`.**

```ts
// Server-only. One warm headless Chromium per function instance (Fluid compute
// reuses instances across requests, so relaunching per render would waste the
// 2–5 s cold start). Vercel → @sparticuz/chromium; local dev →
// CHROMIUM_EXECUTABLE_PATH (a local Chrome). Both are loaded lazily so
// importing this module never touches a native binary.
import { chromium, type Browser } from 'playwright-core'

export class RendererUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RendererUnavailableError'
  }
}

let browserPromise: Promise<Browser> | null = null

async function launch(): Promise<Browser> {
  const localPath = process.env.CHROMIUM_EXECUTABLE_PATH
  if (localPath) return chromium.launch({ executablePath: localPath, headless: true })
  if (process.env.VERCEL) {
    const sparticuz = (await import('@sparticuz/chromium')).default
    sparticuz.setGraphicsMode = false
    return chromium.launch({ args: sparticuz.args, executablePath: await sparticuz.executablePath(), headless: true })
  }
  throw new RendererUnavailableError('No Chromium available — set CHROMIUM_EXECUTABLE_PATH for local rendering.')
}

export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const existing = await browserPromise.catch(() => null)
    if (existing?.isConnected()) return existing
  }
  browserPromise = launch()
  try {
    return await browserPromise
  } catch (err) {
    browserPromise = null
    throw err
  }
}

// Test-only: close the shared browser so vitest can exit cleanly.
export async function closeBrowserForTests(): Promise<void> {
  const b = browserPromise ? await browserPromise.catch(() => null) : null
  browserPromise = null
  await b?.close()
}
```

- [ ] **Step 6: Implement `lib/design/render/render-composed.ts`.**

```ts
// Server-only. Render one composed Design Studio document (live page shell +
// draft theme CSS) at a viewport and return PNG screenshots:
//   desktop → the above-the-fold shot + up to 3 block crops (crops: true)
//   mobile  → the fold + the next viewport down
// Every network request is filtered through isAllowedRenderRequest and capped.
import {
  CROP_SELECTORS,
  MAX_RENDER_REQUESTS,
  PAGE_TIMEOUT_MS,
  VIEWPORTS,
  hardenForRender,
  isAllowedRenderRequest,
  type ViewportKey,
} from './harden'
import { getBrowser } from './browser'

export type RenderShot = { kind: 'fold' | 'next' | 'block'; selector?: string; png: Buffer }
export type RenderResult = {
  shots: RenderShot[]
  timings: { launchMs: number; renderMs: number }
  blockedRequests: number
}

const MAX_BLOCK_CROPS = 3

export async function renderComposed(args: {
  html: string
  shellOrigin: string
  viewport: ViewportKey
  crops?: boolean
}): Promise<RenderResult> {
  const t0 = Date.now()
  const browser = await getBrowser()
  const launchMs = Date.now() - t0

  const vp = VIEWPORTS[args.viewport]
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
  })
  let requests = 0
  let blockedRequests = 0
  await context.route('**/*', (route) => {
    requests++
    if (requests > MAX_RENDER_REQUESTS || !isAllowedRenderRequest(route.request().url(), args.shellOrigin)) {
      blockedRequests++
      return route.abort()
    }
    return route.continue()
  })

  const shots: RenderShot[] = []
  try {
    const page = await context.newPage()
    page.setDefaultTimeout(PAGE_TIMEOUT_MS)
    await page.setContent(hardenForRender(args.html), { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS })
    // CDP evaluate is not subject to the page CSP; wait for webfonts so type renders.
    await page.evaluate(async () => {
      await document.fonts.ready
    })

    shots.push({ kind: 'fold', png: await page.screenshot({ type: 'png' }) })

    if (args.viewport === 'mobile') {
      await page.evaluate((h) => window.scrollTo(0, h), vp.height)
      shots.push({ kind: 'next', png: await page.screenshot({ type: 'png' }) })
    } else if (args.crops) {
      for (const selector of CROP_SELECTORS) {
        if (shots.filter((s) => s.kind === 'block').length >= MAX_BLOCK_CROPS) break
        const el = page.locator(selector).first()
        if ((await el.count()) === 0) continue
        shots.push({ kind: 'block', selector, png: await el.screenshot({ type: 'png', timeout: 5_000 }) })
      }
    }
  } finally {
    await context.close()
  }

  return { shots, timings: { launchMs, renderMs: Date.now() - t0 }, blockedRequests }
}
```

- [ ] **Step 7: Run the integration test with local Chrome, then without.**

```bash
CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npx vitest run lib/design/render/render-composed.test.ts
npx vitest run lib/design/render/render-composed.test.ts
```

Expected:
- **With Chrome:** 3 tests pass and 1 is skipped.
- **Without Chrome:** 1 test passes and 3 are skipped.
- If the `blockedRequests` assertion fails because the `<img>` to `evil.test` was never requested, keep the assertion and make the image eager (`loading="eager"`). It must be requested and blocked.

- [ ] **Step 8: Run the checks.**
Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean. The full suite passes, with the render tests skipped because the default env has no Chrome.

- [ ] **Step 9: Commit.**

```bash
git add package.json package-lock.json .env.example lib/design/render/browser.ts lib/design/render/render-composed.ts lib/design/render/render-composed.test.ts
git commit -m "feat(design-studio): headless renderer (playwright-core + @sparticuz/chromium, warm reuse, request allowlist)"
```

---

### Task 5: Screenshot storage and external capture

**Files:**
- Create: `lib/design/storage.ts`, `lib/design/storage.test.ts`, `lib/design/capture/external.ts`, `lib/design/capture/external.test.ts`
- Modify: `CLAUDE.md` (the Storage paths conventions list)

**Interfaces:**
- Consumes: `isUrlPubliclyFetchable(url)` from `lib/audit/ssrf-guard.ts`; `fileTypeFromBuffer` from `file-type`; `sharp`.
- Produces (`storage.ts`, server-only):
  - `SCREENSHOT_MAX_EDGE = 1568`
  - `toWebp(image: Buffer): Promise<{ webp: Buffer; width: number; height: number }>`
  - `designStoragePath(sessionId: string, ...segments: string[]): string`, which throws `Error` on an invalid id or segment
  - `storeDesignImage(supabase: SupabaseClient<Database>, path: string, webp: Buffer): Promise<void>`
  - `signDesignPaths(supabase: SupabaseClient<Database>, paths: string[]): Promise<Record<string, string>>`
- Produces (`capture/external.ts`, server-only):
  - `type ExternalCapture = { ok: true; webp: Buffer; width: number; height: number } | { ok: false; reason: string }`
  - `captureExternalScreenshot(rawUrl: string): Promise<ExternalCapture>`

- [ ] **Step 1: Write the failing storage tests** in `lib/design/storage.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import { toWebp, designStoragePath, storeDesignImage, signDesignPaths, SCREENSHOT_MAX_EDGE } from './storage'

const SID = '7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184'

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#003b71' } }).png().toBuffer()
}

describe('toWebp', () => {
  it('re-encodes to WebP and caps the long edge at 1568', async () => {
    const r = await toWebp(await png(2880, 1800))
    expect(r.webp.subarray(8, 12).toString('ascii')).toBe('WEBP')
    expect(Math.max(r.width, r.height)).toBe(SCREENSHOT_MAX_EDGE)
    expect(r.width / r.height).toBeCloseTo(1.6, 1)
  })
  it('never upscales', async () => {
    const r = await toWebp(await png(390, 844))
    expect([r.width, r.height]).toEqual([390, 844])
  })
})

describe('designStoragePath', () => {
  it('builds a design/{session}/... path', () => {
    expect(designStoragePath(SID, 'renders', 'abc-desktop-0.webp')).toBe(`design/${SID}/renders/abc-desktop-0.webp`)
  })
  it.each([
    ['bad session id', ['not-a-uuid', 'x.webp']],
    ['traversal segment', [SID, '..', 'x.webp']],
    ['slash inside a segment', [SID, 'a/b.webp']],
    ['empty segment', [SID, '', 'x.webp']],
    ['leading dot', [SID, '.hidden']],
  ])('rejects %s', (_l, args) => {
    const [sid, ...segs] = args as [string, ...string[]]
    expect(() => designStoragePath(sid, ...segs)).toThrow()
  })
})

describe('storage wrappers', () => {
  it('uploads WebP without upsert and signs for one hour', async () => {
    const upload = vi.fn(async () => ({ data: {}, error: null }))
    const createSignedUrls = vi.fn(async (paths: string[]) => ({
      data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}`, error: null })),
      error: null,
    }))
    const from = vi.fn(() => ({ upload, createSignedUrls }))
    const supabase = { storage: { from } } as never
    await storeDesignImage(supabase, `design/${SID}/renders/a.webp`, Buffer.from('x'))
    expect(from).toHaveBeenCalledWith('session-assets')
    expect(upload).toHaveBeenCalledWith(`design/${SID}/renders/a.webp`, expect.any(Buffer), { contentType: 'image/webp', upsert: false })
    const signed = await signDesignPaths(supabase, [`design/${SID}/renders/a.webp`])
    expect(createSignedUrls).toHaveBeenCalledWith([`design/${SID}/renders/a.webp`], 3600)
    expect(signed[`design/${SID}/renders/a.webp`]).toBe(`https://signed/design/${SID}/renders/a.webp`)
  })

  it('throws when the upload fails', async () => {
    const supabase = { storage: { from: () => ({ upload: async () => ({ data: null, error: { message: 'boom' } }) }) } } as never
    await expect(storeDesignImage(supabase, `design/${SID}/x.webp`, Buffer.from('x'))).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `npx vitest run lib/design/storage.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `lib/design/storage.ts`.**

```ts
// Server-only. Design Studio images (renders, input captures, attachments) in
// the PRIVATE session-assets bucket under design/{sessionId}/…, always WebP,
// long edge ≤ 1568 px (the size vision models read without downsampling).
// Never getPublicUrl, never the `assets` table (that feeds deliverables).
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export const SCREENSHOT_MAX_EDGE = 1568
const BUCKET = 'session-assets'
const SIGNED_URL_TTL = 3600
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEGMENT_RE = /^[a-z0-9][a-z0-9._-]*$/i

export async function toWebp(image: Buffer): Promise<{ webp: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(image)
    .resize({ width: SCREENSHOT_MAX_EDGE, height: SCREENSHOT_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true })
  return { webp: data, width: info.width, height: info.height }
}

export function designStoragePath(sessionId: string, ...segments: string[]): string {
  if (!UUID_RE.test(sessionId)) throw new Error('designStoragePath: invalid session id')
  if (segments.length === 0 || segments.some((s) => !SEGMENT_RE.test(s) || s.includes('..'))) {
    throw new Error('designStoragePath: invalid path segment')
  }
  return `design/${sessionId}/${segments.join('/')}`
}

export async function storeDesignImage(supabase: SupabaseClient<Database>, path: string, webp: Buffer): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, webp, { contentType: 'image/webp', upsert: false })
  if (error) throw new Error(`storeDesignImage failed: ${error.message}`)
}

export async function signDesignPaths(supabase: SupabaseClient<Database>, paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL)
  if (error || !data) throw new Error(`signDesignPaths failed: ${error?.message ?? 'no data'}`)
  const out: Record<string, string> = {}
  for (const row of data) if (row.path && row.signedUrl) out[row.path] = row.signedUrl
  return out
}
```

- [ ] **Step 4: Run the tests.**
Run: `npx vitest run lib/design/storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing external-capture tests** in `lib/design/capture/external.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import sharp from 'sharp'

const fetchable = vi.fn(async () => true)
vi.mock('@/lib/audit/ssrf-guard', () => ({ isUrlPubliclyFetchable: (u: string) => fetchable(u) }))

import { captureExternalScreenshot } from './external'

let pngBytes: Buffer
beforeEach(async () => {
  pngBytes = await sharp({ create: { width: 1440, height: 900, channels: 3, background: '#fff' } }).png().toBuffer()
  process.env.SCRAPINGBEE_API_KEY = 'test-key'
  fetchable.mockResolvedValue(true)
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.SCRAPINGBEE_API_KEY
})

function stubFetch(...responses: Response[]) {
  const f = vi.fn()
  for (const r of responses) f.mockResolvedValueOnce(r)
  vi.stubGlobal('fetch', f)
  return f
}

describe('captureExternalScreenshot', () => {
  it('captures via ScrapingBee screenshot mode and returns WebP', async () => {
    const f = stubFetch(new Response(new Uint8Array(pngBytes), { status: 200 }))
    const r = await captureExternalScreenshot('https://competitor.example.com/')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.webp.subarray(8, 12).toString('ascii')).toBe('WEBP')
    const calledUrl = new URL(String(f.mock.calls[0][0]))
    expect(calledUrl.searchParams.get('screenshot')).toBe('true')
    expect(calledUrl.searchParams.get('url')).toBe('https://competitor.example.com/')
    expect(calledUrl.searchParams.get('stealth_proxy')).toBeNull()
  })

  it('retries once with the stealth proxy when the first attempt fails', async () => {
    const f = stubFetch(new Response('blocked', { status: 500 }), new Response(new Uint8Array(pngBytes), { status: 200 }))
    const r = await captureExternalScreenshot('https://waf.example.com/')
    expect(r.ok).toBe(true)
    expect(new URL(String(f.mock.calls[1][0])).searchParams.get('stealth_proxy')).toBe('true')
  })

  it.each([
    ['non-http scheme', 'ftp://x.example.com/'],
    ['credentials', 'https://user:pw@x.example.com/'],
    ['too long', 'https://x.example.com/' + 'a'.repeat(300)],
    ['garbage', 'not a url'],
  ])('rejects %s without calling ScrapingBee', async (_l, url) => {
    const f = stubFetch()
    const r = await captureExternalScreenshot(url)
    expect(r.ok).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  it('rejects private / internal hosts via the SSRF guard', async () => {
    fetchable.mockResolvedValue(false)
    const f = stubFetch()
    const r = await captureExternalScreenshot('https://internal.example.com/')
    expect(r).toMatchObject({ ok: false })
    expect(f).not.toHaveBeenCalled()
  })

  it('rejects a non-image response (magic bytes)', async () => {
    stubFetch(new Response('<html>not an image</html>', { status: 200 }), new Response('<html></html>', { status: 200 }))
    const r = await captureExternalScreenshot('https://x.example.com/')
    expect(r.ok).toBe(false)
  })

  it('reports not-configured without a key', async () => {
    delete process.env.SCRAPINGBEE_API_KEY
    const r = await captureExternalScreenshot('https://x.example.com/')
    expect(r).toEqual({ ok: false, reason: 'Screenshot capture is not configured.' })
  })
})
```

- [ ] **Step 6: Run them and confirm they fail.**
Run: `npx vitest run lib/design/capture/external.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 7: Implement `lib/design/capture/external.ts`.**

```ts
// Server-only. Screenshot an EXTERNAL site (inspiration / competitor / the
// client's current site) via the ScrapingBee screenshot API — arbitrary
// third-party pages never load in our own browser (which runs beside our
// secrets). SSRF-checked before we spend a ScrapingBee credit; the returned
// bytes are magic-byte verified and re-encoded to WebP (strips metadata).
import { fileTypeFromBuffer } from 'file-type'
import { isUrlPubliclyFetchable } from '@/lib/audit/ssrf-guard'
import { toWebp } from '@/lib/design/storage'

export type ExternalCapture = { ok: true; webp: Buffer; width: number; height: number } | { ok: false; reason: string }

const SCRAPINGBEE_API = 'https://app.scrapingbee.com/api/v1/'
const TIMEOUT_MS = 45_000
const MAX_URL_LENGTH = 300
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp'])

async function attempt(key: string, url: string, stealth: boolean): Promise<Buffer | null> {
  const params = new URLSearchParams({
    api_key: key,
    url,
    screenshot: 'true',
    window_width: '1440',
    window_height: '900',
    render_js: 'true',
    block_ads: 'true',
    wait: '1500',
  })
  if (stealth) params.set('stealth_proxy', 'true')
  try {
    const res = await fetch(`${SCRAPINGBEE_API}?${params.toString()}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) {
      console.warn(`[design-capture] ScrapingBee screenshot failed for ${url}: HTTP ${res.status}${stealth ? ' (stealth)' : ''}`)
      return null
    }
    return Buffer.from(await res.arrayBuffer())
  } catch (err) {
    console.warn(`[design-capture] ScrapingBee screenshot error for ${url}:`, err)
    return null
  }
}

export async function captureExternalScreenshot(rawUrl: string): Promise<ExternalCapture> {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' }
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'Only http(s) URLs can be captured.' }
  if (u.username || u.password) return { ok: false, reason: 'URLs with credentials are not allowed.' }
  if (rawUrl.length > MAX_URL_LENGTH) return { ok: false, reason: 'That URL is too long.' }

  const key = process.env.SCRAPINGBEE_API_KEY
  if (!key) return { ok: false, reason: 'Screenshot capture is not configured.' }
  if (!(await isUrlPubliclyFetchable(u.toString()))) return { ok: false, reason: 'That URL is not publicly reachable.' }

  let bytes = await attempt(key, u.toString(), false)
  let type = bytes ? await fileTypeFromBuffer(bytes) : undefined
  if (!bytes || !type || !IMAGE_MIMES.has(type.mime)) {
    bytes = await attempt(key, u.toString(), true)
    type = bytes ? await fileTypeFromBuffer(bytes) : undefined
  }
  if (!bytes || !type || !IMAGE_MIMES.has(type.mime)) return { ok: false, reason: 'Could not capture a screenshot of that site.' }

  const { webp, width, height } = await toWebp(bytes)
  return { ok: true, webp, width, height }
}
```

Note: the magic-byte test stubs two HTML responses, because a non-image first attempt triggers the one stealth retry. That's intended.

- [ ] **Step 8: Run the tests.**
Run: `npx vitest run lib/design/capture/external.test.ts lib/design/storage.test.ts`
Expected: PASS.

- [ ] **Step 9: Document the storage prefix.** In `CLAUDE.md`, under "Supabase Storage" → "Storage paths follow these conventions:", add after the generated-PDFs line:

```markdown
  - Design Studio images: `design/{sessionId}/{renders|inputs|runs|versions|attachments}/…webp` (WebP, long edge ≤ 1568; signed URLs only; never the `assets` table)
```

Before staging CLAUDE.md, check `git diff CLAUDE.md`. If an uncommitted `nextjs-agent-rules` block written by `next dev` is present, stage only this hunk. Otherwise stage normally.

- [ ] **Step 10: Run the checks and commit.**
Run: `npx tsc --noEmit && npm run lint`, then:

```bash
git add lib/design/storage.ts lib/design/storage.test.ts lib/design/capture/external.ts lib/design/capture/external.test.ts CLAUDE.md
git commit -m "feat(design-studio): WebP screenshot storage + ScrapingBee external capture"
```

---

### Task 6: `POST /api/edit/[id]/design/render` plus the Vercel packaging

**Files:**
- Create: `app/api/edit/[id]/design/render/route.ts`, `app/api/edit/[id]/design/render/route.test.ts`
- Modify: `next.config.ts`, `vercel.json`

**Interfaces:**
- Consumes:
  - `requireDesignAdmin` (Task 2)
  - `getPreviewSiteUrl`, `resolvePreviewPageUrl` (Task 1)
  - `buildPreviewShell` (existing)
  - `loadDraftThemeSources` (Task 3)
  - `composePreviewSrcDoc` (existing, with `htmlAttributes`)
  - `renderComposed`, `RendererUnavailableError` (Task 4)
  - `toWebp`, `designStoragePath`, `storeDesignImage`, `signDesignPaths` (Task 5)
- Produces: `POST` body `{ path?: string; viewport?: 'desktop' | 'mobile' }`. The response is `{ renderId: string; path: string; viewport: ViewportKey; timings: { launchMs: number; renderMs: number; totalMs: number }; blockedRequests: number; shots: { kind: 'fold' | 'next' | 'block'; selector?: string; width: number; height: number; url: string }[] }`.

- [ ] **Step 1: Write the failing route tests** in `app/api/edit/[id]/design/render/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const SID = '7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184'
const gate = vi.fn()
const render = vi.fn()
const store = vi.fn(async () => undefined)

vi.mock('../_design', () => ({ requireDesignAdmin: (id: string) => gate(id) }))
vi.mock('@/lib/theme-preview/site-url', () => ({ getPreviewSiteUrl: async () => 'https://bblcpa.vercel.app/' }))
vi.mock('@/lib/theme-preview/build-preview-shell', () => ({
  buildPreviewShell: async () => ({ ok: true, origin: 'https://bblcpa.vercel.app/', shellHtml: '<html><head><!--__C5_THEME_SLOT__--></head><body></body></html>' }),
}))
vi.mock('@/lib/design/theme-sources', () => ({
  loadDraftThemeSources: async () => ({
    ok: true,
    sources: {
      themeCss: ':root{}',
      overridesCss: '',
      typography: { headingFont: 'Inter', bodyFont: 'Inter', accentFont: 'Fraunces', googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter' },
      headlineStyle: 'serif',
      eyebrowStyle: 'standard',
    },
  }),
}))
vi.mock('@/lib/design/render/render-composed', () => ({ renderComposed: (a: unknown) => render(a) }))
vi.mock('@/lib/design/render/browser', () => ({
  RendererUnavailableError: class RendererUnavailableError extends Error {},
}))
vi.mock('@/lib/design/storage', () => ({
  toWebp: async () => ({ webp: Buffer.from('w'), width: 1440, height: 900 }),
  designStoragePath: (sid: string, ...s: string[]) => `design/${sid}/${s.join('/')}`,
  storeDesignImage: (...a: unknown[]) => store(...a),
  signDesignPaths: async (_s: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))

import { POST } from './route'
import { RendererUnavailableError } from '@/lib/design/render/browser'

const params = { params: Promise.resolve({ id: SID }) }
const req = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  gate.mockReset()
  render.mockReset()
  store.mockClear()
  gate.mockResolvedValue({ sessionId: SID, jobId: 'j', githubRepo: 'o/r', user: { isAdmin: true } })
  render.mockResolvedValue({ shots: [{ kind: 'fold', png: Buffer.from('p') }], timings: { launchMs: 5, renderMs: 900 }, blockedRequests: 2 })
})

describe('POST /design/render', () => {
  it('returns the gate response for non-admins', async () => {
    gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await POST(req({}), params)
    expect(res.status).toBe(403)
    expect(render).not.toHaveBeenCalled()
  })

  it('rejects an unsafe page path with 400', async () => {
    const res = await POST(req({ path: '//evil.test' }), params)
    expect(res.status).toBe(400)
    expect(render).not.toHaveBeenCalled()
  })

  it('rejects an unknown viewport with 400', async () => {
    const res = await POST(req({ viewport: 'tablet' }), params)
    expect(res.status).toBe(400)
  })

  it('composes the draft theme with treatment attributes, stores WebP, and returns signed URLs', async () => {
    const res = await POST(req({ path: '/services', viewport: 'desktop' }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    const call = render.mock.calls[0][0] as { html: string; viewport: string; crops: boolean; shellOrigin: string }
    expect(call.viewport).toBe('desktop')
    expect(call.crops).toBe(true)
    expect(call.html).toContain('data-headline="serif"')
    expect(call.html).toContain(':root{}')
    expect(store).toHaveBeenCalledTimes(1)
    expect(body.shots[0].url).toMatch(new RegExp(`^https://signed/design/${SID}/renders/`))
    expect(body.path).toBe('/services')
    expect(body.timings.renderMs).toBe(900)
  })

  it('maps RendererUnavailableError to 503', async () => {
    render.mockRejectedValue(new RendererUnavailableError('no chromium'))
    const res = await POST(req({}), params)
    expect(res.status).toBe(503)
  })
})
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `npx vitest run "app/api/edit/[id]/design/render/route.test.ts"`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement the route** `app/api/edit/[id]/design/render/route.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { getPreviewSiteUrl } from '@/lib/theme-preview/site-url'
import { resolvePreviewPageUrl } from '@/lib/theme-preview/page-path'
import { buildPreviewShell } from '@/lib/theme-preview/build-preview-shell'
import { composePreviewSrcDoc } from '@/lib/theme-preview/compose-srcdoc'
import { loadDraftThemeSources } from '@/lib/design/theme-sources'
import { renderComposed } from '@/lib/design/render/render-composed'
import { RendererUnavailableError } from '@/lib/design/render/browser'
import type { ViewportKey } from '@/lib/design/render/harden'
import { toWebp, designStoragePath, storeDesignImage, signDesignPaths } from '@/lib/design/storage'
import { requireDesignAdmin } from '../_design'

export const runtime = 'nodejs'
export const maxDuration = 120

interface RenderRequestBody {
  path?: string
  viewport?: string
}

// POST — render one page of the client's site with the DRAFT theme applied
// (live page shell + draft theme.css/overrides + treatment attributes) in
// headless Chromium; store WebP screenshots under design/{sessionId}/renders/
// and return short-lived signed URLs. Admin-only. The Design Studio critique
// loop (P4) and chat render_preview tool (P5) build on this.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const started = Date.now()
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  const body = (await req.json().catch(() => ({}))) as RenderRequestBody
  const viewport = (body.viewport ?? 'desktop') as ViewportKey
  if (viewport !== 'desktop' && viewport !== 'mobile') {
    return NextResponse.json({ error: 'viewport must be desktop or mobile.' }, { status: 400 })
  }

  try {
    const siteUrl = await getPreviewSiteUrl({ jobId: ctx.jobId, githubRepo: ctx.githubRepo })
    if (!siteUrl) return NextResponse.json({ error: 'No preview URL is set for this client.' }, { status: 409 })
    const page = resolvePreviewPageUrl(siteUrl, body.path ?? null)
    if (!page.ok) return NextResponse.json({ error: page.reason }, { status: 400 })

    const [shell, loaded] = await Promise.all([buildPreviewShell(page.url), loadDraftThemeSources(ctx.githubRepo)])
    if (!shell.ok) return NextResponse.json({ error: shell.reason }, { status: 502 })
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    const { sources } = loaded

    const html = composePreviewSrcDoc({
      shellHtml: shell.shellHtml,
      themeCss: sources.themeCss,
      overridesCss: sources.overridesCss,
      typography: sources.typography,
      htmlAttributes: { 'data-headline': sources.headlineStyle, 'data-eyebrow': sources.eyebrowStyle },
    })

    const result = await renderComposed({ html, shellOrigin: shell.origin, viewport, crops: viewport === 'desktop' })

    const supabase = createServerClient()
    const renderId = randomUUID()
    const stored = await Promise.all(
      result.shots.map(async (shot, i) => {
        const { webp, width, height } = await toWebp(shot.png)
        const path = designStoragePath(ctx.sessionId, 'renders', `${renderId}-${viewport}-${i}.webp`)
        await storeDesignImage(supabase, path, webp)
        return { kind: shot.kind, selector: shot.selector, width, height, path }
      })
    )
    const signed = await signDesignPaths(supabase, stored.map((s) => s.path))

    return NextResponse.json({
      renderId,
      path: page.path,
      viewport,
      timings: { ...result.timings, totalMs: Date.now() - started },
      blockedRequests: result.blockedRequests,
      shots: stored.map(({ path, ...rest }) => ({ ...rest, url: signed[path] })),
    })
  } catch (err) {
    if (err instanceof RendererUnavailableError) {
      return NextResponse.json({ error: 'The renderer is unavailable right now.' }, { status: 503 })
    }
    return internalError('design:render', err, 'Failed to render the page')
  }
}
```

- [ ] **Step 4: Run the tests.**
Run: `npx vitest run "app/api/edit/[id]/design/render/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Package it for Vercel.**
1. In `next.config.ts`, change `serverExternalPackages: ['lightningcss']` to:
   ```ts
   serverExternalPackages: ['lightningcss', '@sparticuz/chromium', 'playwright-core'],
   ```
2. Add this entry to `outputFileTracingIncludes`, with a comment:
   ```ts
    // @sparticuz/chromium ships its brotli-compressed Chromium in bin/, which it
    // loads by path at runtime — tracing can't see it, so force-include it.
    '/api/edit/\\[id\\]/design/render': ['./node_modules/@sparticuz/chromium/bin/**'],
   ```
3. In `vercel.json` → `functions`, add:
   ```json
    "app/api/edit/[id]/design/render/route.ts": {
      "maxDuration": 120,
      "memory": 3009
    }
   ```

If a later Vercel deploy rejects `memory: 3009` because it's above the plan's limit, set it to `2048` and note that in the gate record (Task 7). Chromium usually fits in 2 GB for single-page renders.

- [ ] **Step 6: Build and verify the trace.**

```bash
npm run build
node -e "const f=require('./.next/server/app/api/edit/[id]/design/render/route.js.nft.json').files;console.log('chromium bin',f.filter(x=>x.includes('@sparticuz/chromium/bin')).length,'playwright-core',f.filter(x=>x.includes('playwright-core')).length)"
```

Expected: the build exits 0, and both counts are above 0. If the chromium `bin` count is 0, stop and report the exact key you used and the Next docs section you checked.

- [ ] **Step 7: Run the full verification and commit.**
Run: `npx tsc --noEmit && npm run lint && npm test`, plus the three CLAUDE.md greps. Then:

```bash
git add "app/api/edit/[id]/design/render/route.ts" "app/api/edit/[id]/design/render/route.test.ts" next.config.ts vercel.json
git commit -m "feat(design-studio): admin render route (draft theme on live shell → WebP + signed URLs) + Vercel packaging"
```

---

### Task 7: Go/no-go gate on a Vercel preview (controller and user)

This is a measurement, not code. The controller runs it with the user, because it needs a preview deploy and an admin session on that deploy.

- [ ] **Step 1: Push the branch.** Run `git push -u origin feat/design-studio-p1`. Vercel builds a **preview** deployment; production is untouched. Wait until it's Ready (`vercel ls counting-five-admin`) and confirm the build log shows commit HEAD.
- [ ] **Step 2: Ask the user to sign in on the preview URL** in the shared Chrome tab. Preview deployments may be behind Vercel auth, and admin login is required.
- [ ] **Step 3: Measure.** Run this in the page context (javascript tool), using bblcpa's session id `7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184`. It makes 1 cold render and then 12 warm ones (6 desktop, 6 mobile):

```js
const id = '7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184'
const run = async (viewport, path) => {
  const t = performance.now()
  const r = await fetch(`/api/edit/${id}/design/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ viewport, path }) })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, viewport, path, client: Math.round(performance.now() - t), ...(j.timings ?? {}), shots: j.shots?.length ?? 0, blocked: j.blockedRequests, error: j.error }
}
const out = [await run('desktop', '/')]
for (let i = 0; i < 6; i++) { out.push(await run('desktop', i % 2 ? '/' : '/services')); out.push(await run('mobile', '/')) }
JSON.stringify(out)
```

- [ ] **Step 4: Check the logs.** Read the Vercel logs for the render function (`vercel logs <preview-url>`, or the dashboard). Look for OOM (`Runtime exited`, `SIGKILL`, "memory"), timeouts, and 5xx.
- [ ] **Step 5: Record the result.** Write `docs/superpowers/specs/2026-09-24-design-studio-p1-gate.md` with:
  - the raw table;
  - cold `launchMs`;
  - warm p50 and p95 of `renderMs` (the per-render browser time) and of `totalMs`;
  - peak memory, if the dashboard shows it;
  - any errors;
  - the verdict.

  **Gate:** warm p95 `renderMs` < 5000 **and** no OOM/5xx across the 13 calls. `totalMs` includes the shell fetch and storage; record it, but it does not gate.
- [ ] **Step 6: Commit the gate record** with the message `docs(design-studio): P1 renderer go/no-go result`.
- [ ] **Step 7: Decide.**
  - **GO:** P1 is done. The branch can merge to master after the final review (the user decides when to merge or push to production).
  - **NO-GO:** stop. Present the numbers and the fallback options from the spec (Browserless `/screenshot` with `html`, or Vercel Sandbox) to the user. Do not merge.

---

## Out of scope for P1

- Tables, inputs UI, and versions (P2)
- Brief and concept generation (P3)
- Axe/overflow/hidden-block metrics and critique (P4, which adds `lib/design/render/metrics.ts` onto `renderComposed`)
- Chat `render_preview` (P5)
- Template changes (T1–T3)
