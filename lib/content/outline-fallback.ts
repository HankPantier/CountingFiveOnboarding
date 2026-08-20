// Shared, client-safe (no server imports) so both the server-side outline
// generator and the client OutlineCard agree on the fallback marker. When
// outline generation fails to parse a real outline it writes a placeholder row;
// this sentinel lets the approval UI flag it so a placeholder can't be approved
// unnoticed.
export const OUTLINE_FALLBACK_NOTE =
  '⚠ Needs review — auto-generated placeholder (outline generation failed). Edit the sections before approving.'

const FALLBACK_PREFIX = '⚠ Needs review'

export function isFallbackOutline(adminNotes: string | null | undefined): boolean {
  return typeof adminNotes === 'string' && adminNotes.startsWith(FALLBACK_PREFIX)
}
