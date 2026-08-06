// Pure helpers for the AI content editor's targeted find-and-replace tool.
// The editor no longer re-emits the whole file (which truncated on large pages
// and silently dropped the write); instead the agent supplies an exact snippet
// to find and its replacement, and we verify the match landed before writing.
import { splitFile } from './frontmatter'
import { validateAnnotationSyntax } from '@/lib/content/block-annotation-validator'

export type FindReplaceResult =
  | { ok: true; next: string; count: number }
  | { ok: false; count: number; reason: string }

// Literal (non-regex) find-and-replace over the file text. By default the
// `find` snippet must occur EXACTLY once — 0 matches means the anchor is wrong,
// and >1 means it's ambiguous and could edit the wrong spot. Pass `all` to
// replace every occurrence (e.g. a phone number repeated on one page).
export function applyFindReplace(
  content: string,
  find: string,
  replace: string,
  all = false
): FindReplaceResult {
  if (find === '') {
    return { ok: false, count: 0, reason: 'The find text is empty.' }
  }
  const count = content.split(find).length - 1
  if (count === 0) {
    return {
      ok: false,
      count,
      reason: 'The find text was not found in the file. Copy an exact snippet (including punctuation and casing) from the current file.',
    }
  }
  if (count > 1 && !all) {
    return {
      ok: false,
      count,
      reason: `The find text matches ${count} places. Extend it with surrounding context so it uniquely identifies one spot, or set all=true to replace every occurrence.`,
    }
  }
  const next = all ? content.split(find).join(replace) : content.replace(find, replace)
  return { ok: true, next, count }
}

// Guard a proposed edit against breaking block annotations: strip frontmatter
// and check every `<!-- block: … -->` still has a known id + valid variant.
// Returns [] when the page is fine to write.
export function validatePageAnnotations(fullFileContent: string): string[] {
  const { body } = splitFile(fullFileContent)
  return validateAnnotationSyntax(body)
}
