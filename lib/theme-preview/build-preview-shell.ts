import { safeGet } from '@/lib/audit/crawl'
import { THEME_SLOT } from './compose-srcdoc'

// Build a re-skinnable "shell" of the client's REAL deployed site for the Theme
// Studio preview: fetch the homepage (SSRF-guarded), keep its real markup + real
// (Tailwind-compiled) CSS, and leave a slot in <head> where the pending draft
// theme.css + design-overrides.css get injected on top. Because the compiled
// utilities reference var(--color-*), overriding those tokens in the injected
// theme re-skins the real page 1:1 — no hand-authored approximation.
//
// Server-only (uses safeGet / node fetch). The result is rendered in a fully
// sandboxed iframe (no scripts, no same-origin), so external HTML can neither
// run JS nor read anything from the admin app.

// Preconnect + the two template fonts (Public Sans + Fraunces). next/font serves
// its own hashed fonts from /_next, which may not pass CORS into the sandboxed
// frame; pinning the same families via Google Fonts (which sets CORS) guarantees
// type fidelity. The injected theme aliases --font-*-loaded to these.
const FONT_HEAD = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;700&family=Fraunces:ital,wght@0,400;1,400;1,500&display=swap" rel="stylesheet">`

export type PreviewShell =
  | { ok: true; origin: string; shellHtml: string }
  | { ok: false; reason: string }

// Pure transform of a fetched page into the re-skinnable shell. Separated from
// the fetch so it can be unit-tested without a network. `finalUrl` is the
// post-redirect URL (for the <base>).
export function transformShellHtml(rawHtml: string, finalUrl: string): PreviewShell {
  if (!/<head[^>]*>/i.test(rawHtml) || !/<\/head>/i.test(rawHtml)) {
    return { ok: false, reason: 'The live page has no <head> to inject the theme into.' }
  }

  // Resolve the base so the real page's relative CSS/images (/_next/…,
  // /content-assets/…) load from the deployed origin inside the iframe.
  let baseHref: string
  try {
    baseHref = new URL('/', finalUrl).toString()
  } catch {
    return { ok: false, reason: 'The live site URL is invalid.' }
  }

  // The iframe is sandboxed (scripts never run), but strip scripts, the site's
  // own CSP meta (would block our injected inline theme), and any base tag so we
  // control resolution. Belt-and-suspenders, and keeps the console clean.
  let html = rawHtml
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '')

  const headInject = `<base href="${baseHref.replace(/"/g, '&quot;')}">${FONT_HEAD}`
  html = html.replace(/<head[^>]*>/i, (m) => `${m}${headInject}`)
  // Slot for the client-injected theme — must be LAST in <head> so its :root
  // token overrides win over the site's baked-in theme.css.
  html = html.replace(/<\/head>/i, `${THEME_SLOT}</head>`)

  return { ok: true, origin: baseHref, shellHtml: html }
}

export async function buildPreviewShell(siteUrl: string): Promise<PreviewShell> {
  const res = await safeGet(siteUrl)
  if (!res) return { ok: false, reason: 'Could not reach the live site (blocked or unreachable).' }
  if (res.status < 200 || res.status >= 400) {
    return { ok: false, reason: `The live site returned HTTP ${res.status}.` }
  }
  const ct = res.contentType.toLowerCase()
  if (ct && !ct.includes('html')) {
    return { ok: false, reason: 'The site URL did not return an HTML page.' }
  }
  return transformShellHtml(res.body, res.finalUrl)
}
