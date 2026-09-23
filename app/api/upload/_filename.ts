// Shared, pure helpers for the upload presign/confirm routes.

const MAX_NAME_LENGTH = 200

// Reduce a client-supplied file name to a safe basename: take the last path
// segment (either separator), replace anything outside [A-Za-z0-9._-] with
// '_', collapse dot runs so '..' can never survive, and strip leading dots
// (no hidden/dotfile names). Always returns a non-empty string.
export function sanitizeUploadFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .slice(0, MAX_NAME_LENGTH)
  return cleaned || 'file'
}

// Decode-then-normalize check (CLAUDE.md security rule 8) that a storage path
// is a single object directly under `sessions/{sessionId}/` — no encoded
// characters, no empty / '.' / '..' segments, no nested folders.
export function isSessionStoragePath(storagePath: string, sessionId: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(storagePath)
  } catch {
    return false
  }
  if (decoded !== storagePath) return false
  if (decoded.includes('\\')) return false
  const segments = decoded.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return false
  return segments.length === 3 && segments[0] === 'sessions' && segments[1] === sessionId
}

// The display name stored on the assets row: the storage object's basename
// minus the `{uuid}-` prefix presign adds, re-sanitized. Derived from the
// server-issued path rather than trusting the client's fileName. Returns ''
// when the path carries no usable name (caller falls back).
export function fileNameFromStoragePath(storagePath: string): string {
  const base = storagePath.split('/').pop() ?? ''
  const withoutUuid = base.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    ''
  )
  return withoutUuid ? sanitizeUploadFileName(withoutUuid) : ''
}
