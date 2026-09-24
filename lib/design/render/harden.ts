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
