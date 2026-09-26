// Resolve a client-supplied page path (e.g. "/services/tax") against the
// client's deployed site URL for the preview shell / renderer. Decode FIRST,
// then validate (CLAUDE.md security rule 8): a raw startsWith('/') check passes
// "%2F%2Fevil.test" until something downstream decodes it. The result must stay
// on the site's own origin — this feeds a server-side fetch.
const MAX_PATH_LENGTH = 200
// Any fixed origin: a path that resolves off it would resolve off every site.
const PROBE_ORIGIN = 'https://page-path.invalid'

// The path rules alone (no site URL needed), shared by callers that validate a
// page path up front (e.g. the design chat request) and by
// resolvePreviewPageUrl below. Returns the DECODED path.
export function checkPagePath(rawPath: string): { ok: true; path: string } | { ok: false; reason: string } {
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
  try {
    if (new URL(decoded, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return { ok: false, reason: 'The page path must stay on the site.' }
  } catch {
    return { ok: false, reason: 'The page path is invalid.' }
  }
  return { ok: true, path: decoded }
}

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
  // No page requested: use the preview URL exactly as configured (its own
  // path + query, e.g. https://x.vercel.app/home?draft=1) — the pre-Design-
  // Studio behavior of the theme preview.
  if (rawPath == null || rawPath === '') return { ok: true, url: base.toString(), path: base.pathname }

  const checked = checkPagePath(rawPath)
  if (!checked.ok) return checked
  const decoded = checked.path

  let resolved: URL
  try {
    resolved = new URL(decoded, base)
  } catch {
    return { ok: false, reason: 'The page path is invalid.' }
  }
  if (resolved.origin !== base.origin) return { ok: false, reason: 'The page path must stay on the site.' }
  return { ok: true, url: resolved.toString(), path: resolved.pathname }
}
