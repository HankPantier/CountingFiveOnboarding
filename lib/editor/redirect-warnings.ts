// Editor-side formatting of the `redirectWarnings` the nav / move routes
// return: redirects.csv rows that still shadow a real page. They are never
// removed automatically, so the editor must show them after every save path
// (nav save, conflict "keep mine", sidebar nav commit, move dialog, bulk move).
// Pure, so it is unit-tested without a component harness.

/** The response's redirectWarnings as a clean, de-duplicated string list. */
export function readRedirectWarnings(data: unknown): string[] {
  const raw = data && typeof data === 'object' ? (data as { redirectWarnings?: unknown }).redirectWarnings : undefined
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const w of raw) {
    if (typeof w === 'string' && w.trim() && !out.includes(w.trim())) out.push(w.trim())
  }
  return out
}

/**
 * One banner message ("Saved. Redirect check: …") for the warnings, or null
 * when there are none. `lead` says what succeeded ("Saved", "Moved", …).
 */
export function redirectWarningMessage(lead: string, warnings: readonly string[]): string | null {
  const unique = [...new Set(warnings.map((w) => w.trim()).filter(Boolean))]
  if (unique.length === 0) return null
  return `${lead}. Redirect check: ${unique.join(' ')}`
}
