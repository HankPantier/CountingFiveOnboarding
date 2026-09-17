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

export interface BatchEdit {
  find: string
  replace: string
  all?: boolean
}

export interface BatchEditResult {
  next: string
  applied: { find: string; replacements: number }[]
  failed: { find: string; reason: string }[]
}

// Apply many find/replace rewrites against ONE snapshot, folding each success
// into `next`, and land them in a single commit — the rewrite counterpart to
// applyBulkRemovals. A miss (0 matches) or ambiguous find (>1 without `all`) is
// collected into `failed` and does NOT abort the rest, so a large multi-part
// edit converges in one pass instead of truncating on the tool-call cap. Each
// `find` is matched against the running text, so callers must not target text a
// prior edit in the same batch already rewrote. Pure and deterministic.
export function applyBatchEdits(content: string, edits: BatchEdit[]): BatchEditResult {
  let next = content
  const applied: { find: string; replacements: number }[] = []
  const failed: { find: string; reason: string }[] = []
  for (const { find, replace, all } of edits) {
    const res = applyFindReplace(next, find, replace, all ?? false)
    if (res.ok) {
      next = res.next
      applied.push({ find, replacements: res.count })
    } else {
      failed.push({ find, reason: res.reason })
    }
  }
  return { next, applied, failed }
}

// Guard a proposed edit against breaking block annotations: strip frontmatter
// and check every `<!-- block: … -->` still has a known id + valid variant.
// Returns [] when the page is fine to write.
export function validatePageAnnotations(fullFileContent: string): string[] {
  const { body } = splitFile(fullFileContent)
  return validateAnnotationSyntax(body)
}
