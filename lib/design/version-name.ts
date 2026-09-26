// Pure + client-safe. The DISPLAY name a version's stored bundle carries —
// distinct from `summary` (a longer free-text note shown under the name in
// VersionsPanel). A chat/revert version otherwise inherits its seed bundle's
// `name` verbatim (e.g. "Baseline"), which is what every version in a chat or
// restore chain showed before this. commit-version.ts's callers (chat-commit,
// the restore route) set `bundle.name` to one of these before commit; concept
// apply and "Capture as version" keep their own names untouched.
import { BUNDLE_NAME_MAX_LENGTH } from './bundle'

const ELLIPSIS = '…'
// Below this, a word-boundary cut would throw away too much of the text —
// fall back to a hard cut instead.
const MIN_WORD_BOUNDARY_RATIO = 0.6

// Truncates to at most `maxLength` chars, preferring to cut at the last
// space so a name reads as a phrase, not a mid-word chop — unless that space
// is too early in the string, in which case a hard cut keeps more content.
export function truncateName(text: string, maxLength: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) return trimmed
  if (maxLength <= ELLIPSIS.length) return trimmed.slice(0, Math.max(0, maxLength))
  const cut = maxLength - ELLIPSIS.length
  const slice = trimmed.slice(0, cut)
  const lastSpace = slice.lastIndexOf(' ')
  const base = lastSpace >= cut * MIN_WORD_BOUNDARY_RATIO ? slice.slice(0, lastSpace) : slice
  return `${base.trimEnd()}${ELLIPSIS}`
}

// A chat version's name: derived from the turn's commit summary (e.g.
// "Calmed hero-split"), not the seed bundle's name. Falls back to a generic
// label if the summary is somehow blank after trimming.
export function deriveChatVersionName(summary: string): string {
  const name = truncateName(summary, BUNDLE_NAME_MAX_LENGTH)
  return name || 'Chat revision'
}

// A restore version's name: "Restored v{k} — {original name}" when that
// fits the cap, else just "Restored v{k}".
export function deriveRestoreVersionName(versionNo: number, originalName: string): string {
  const base = `Restored v${versionNo}`
  const trimmedOriginal = originalName.trim()
  if (!trimmedOriginal) return base
  const withOriginal = `${base} — ${trimmedOriginal}`
  return withOriginal.length <= BUNDLE_NAME_MAX_LENGTH ? withOriginal : base
}
