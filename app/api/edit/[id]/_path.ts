// Decode + normalize a user-supplied file path. Returns null if the path
// is not safe (contains traversal segments, empty segments, or escapes
// the content/ root). Otherwise returns the normalized form.
//
// We percent-decode before checking because `path.startsWith('content/')`
// passes for `content/..%2F..%2Fetc/passwd` until GitHub / fs layers do
// their own decoding downstream.
export function safePath(raw: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  const segments = decoded.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null
  const normalized = segments.join('/')
  if (!normalized.startsWith('content/')) return null
  return normalized
}
