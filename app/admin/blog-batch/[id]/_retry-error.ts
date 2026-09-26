// Pure helper for BlogBatchProgress's retry/regenerate actions. The retry
// route returns a 409 (with our own message) when every selected draft is
// still in flight (or another 4xx for auth/validation failures) — surface
// that text instead of letting the click silently no-op. 5xx bodies go
// through `internalError()` and intentionally aren't surfaced verbatim here;
// a network-level failure (thrown fetch) isn't a status at all, so this
// only ever fires for a response the server actually sent back.
export function retryErrorMessage(status: number, body: unknown): string | null {
  if (status < 400 || status >= 500) return null
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error
  }
  return null
}
