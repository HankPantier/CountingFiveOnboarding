// Shared, client-safe (no server imports) so both the server-side outline
// generator and the client OutlineCard agree on the fallback marker. When
// outline generation fails to parse a real outline it writes a placeholder row;
// this sentinel lets the approval UI flag it so a placeholder can't be approved
// unnoticed.
export const OUTLINE_FALLBACK_PREFIX = '⚠ Needs review'

export const OUTLINE_FALLBACK_NOTE =
  `${OUTLINE_FALLBACK_PREFIX} — auto-generated placeholder (outline generation failed). Edit the sections before approving.`

// Build a review-flagged note that embeds the real thrown error so the operator
// sees WHY generation failed (previously swallowed into a generic string that
// isFallbackOutline didn't even recognize → the row showed as approvable
// "Pending" instead of "Needs review"). The prefix keeps it recognized.
export function buildOutlineFailureNote(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return `${OUTLINE_FALLBACK_PREFIX} — outline generation failed: ${msg.slice(0, 300)}. Edit the sections before approving.`
}

export function isFallbackOutline(adminNotes: string | null | undefined): boolean {
  return typeof adminNotes === 'string' && adminNotes.startsWith(OUTLINE_FALLBACK_PREFIX)
}
