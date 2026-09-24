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
