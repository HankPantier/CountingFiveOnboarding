// Shared literal replace-all for the AI content editor's edit tools. The naive
// `text.split(find).join(replace)` compounds when the replacement CONTAINS the
// find term (a "wrapping" rule like "service business" -> "professional service
// business"): every re-application wraps another copy, so re-running an
// instruction — or the model re-issuing it against the re-injected file — turns
// "professional service business" into "professional professional … service
// business". This helper makes such a replacement IDEMPOTENT: existing full
// `replace` spans are held out so only bare `find` occurrences are wrapped, and
// applying it any number of times yields the same result.

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function overlapSafeReplaceAll(
  text: string,
  find: string,
  replace: string,
  caseInsensitive = false
): string {
  if (!find) return text

  const overlaps = caseInsensitive
    ? replace.toLowerCase().includes(find.toLowerCase())
    : replace.includes(find)

  // Non-overlapping replacement (incl. every deletion, replace === ''): a plain
  // literal replace-all is already safe. The function form of String.replace
  // inserts `replace` verbatim so `$&`/`$1` are not treated as substitutions.
  if (!overlaps) {
    if (!caseInsensitive) return text.split(find).join(replace)
    return text.replace(new RegExp(escapeRegExp(find), 'gi'), () => replace)
  }

  // Overlapping replacement: protect existing full `replace` spans, wrap only
  // bare `find` in the gaps between them. Case-sensitive path splits on the exact
  // replacement; each resulting segment contains no full `replace`, so wrapping
  // bare finds there and rejoining with `replace` cannot compound on re-run.
  if (!caseInsensitive) {
    return text
      .split(replace)
      .map((segment) => segment.split(find).join(replace))
      .join(replace)
  }

  // Case-insensitive path: walk the existing `replace` spans (preserving their
  // original casing) and wrap bare `find` only in the gaps between them.
  const replaceRe = new RegExp(escapeRegExp(replace), 'gi')
  const findRe = new RegExp(escapeRegExp(find), 'gi')
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = replaceRe.exec(text)) !== null) {
    out += text.slice(last, m.index).replace(findRe, () => replace) + m[0]
    last = m.index + m[0].length
    if (m.index === replaceRe.lastIndex) replaceRe.lastIndex++ // guard against a zero-length match loop
  }
  out += text.slice(last).replace(findRe, () => replace)
  return out
}
