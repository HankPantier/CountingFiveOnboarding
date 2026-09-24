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

// Word-bounded so `<header>`/`<headfoo>` never match — only a real <head> tag.
const HEAD_OPEN_RE = /<head(?=[\s>])[^>]*>/i
const HTML_OPEN_RE = /<html(?=[\s>])[^>]*>/i

export function hardenForRender(html: string): string {
  // Strip HTML comments FIRST — otherwise an attacker can hide a decoy
  // `<head>` inside a comment ahead of the real one and divert the CSP meta
  // into dead markup, leaving the real <head> unprotected.
  let out = html.replace(/<!--[\s\S]*?-->/g, '')

  // Strip scripts (both block and unclosed/self-closing forms), now that any
  // comment-hidden scripts have also been exposed and removed above.
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<script\b[^>]*\/?>/gi, '')

  // Strip meta-refresh redirects (any attribute order/quoting/case) — the CSP
  // alone doesn't block a navigation via <meta http-equiv="refresh">.
  out = out.replace(/<meta\b[^>]*>/gi, (tag) => (/http-equiv\s*=\s*(["']?)refresh\1/i.test(tag) ? '' : tag))

  // Strip inline event-handler attributes (onerror, onload, etc.) — CSP's
  // script-src blocks <script> execution but not attribute-based handlers.
  out = out.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')

  out = out.replace(/\bloading\s*=\s*(["']?)lazy\1/gi, 'loading="eager"')

  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">`
  if (HEAD_OPEN_RE.test(out)) {
    out = out.replace(HEAD_OPEN_RE, (m) => `${m}${cspMeta}`)
  } else if (HTML_OPEN_RE.test(out)) {
    out = out.replace(HTML_OPEN_RE, (m) => `${m}<head>${cspMeta}</head>`)
  } else {
    out = `<head>${cspMeta}</head>${out}`
  }
  return out
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
