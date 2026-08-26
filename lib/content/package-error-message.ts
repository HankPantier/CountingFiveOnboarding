// Turn a failed /package (or deploy) response into operator-facing copy.
//
// The assemble route surfaces genuine, caught failures as `{ error: message }`
// — those are shown verbatim. But a hard Vercel maxDuration timeout (or an OOM)
// returns NO body, so the client's `res.json().catch(() => ({}))` yields `{}`
// with no `.error`. Historically that collapsed to the useless generic
// "Failed to assemble package". This helper distinguishes that bodyless
// gateway/timeout case (504/502/503, or a network-level status 0) and tells the
// operator the work may still be finishing, instead of implying a hard failure.
export function packageErrorMessage(status: number, data: { error?: unknown } | null): string {
  if (data && typeof data.error === 'string' && data.error) return data.error
  if (status === 0 || status === 502 || status === 503 || status === 504) {
    return `Assembly is taking too long for this site (HTTP ${status}) — it may still be finishing in the background. Check the draft in the content editor, or use “Assemble & download only”.`
  }
  return `Failed to assemble package (HTTP ${status})`
}
