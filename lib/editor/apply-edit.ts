// Pure helpers for the AI content editor's targeted find-and-replace tool.
// The editor no longer re-emits the whole file (which truncated on large pages
// and silently dropped the write); instead the agent supplies an exact snippet
// to find and its replacement, and we verify the match landed before writing.
import { splitFile } from './frontmatter'
import { overlapSafeReplaceAll } from './replace'
import { heroPairWarnings, validateAnnotationDelta } from '@/lib/content/block-annotation-validator'

export type FindReplaceResult =
  | { ok: true; next: string; count: number }
  // `noop` — the find matched but replacing it leaves the file byte-identical
  // (the edit is already applied, or find === replace). Callers must NOT commit
  // or report it as a successful change.
  | { ok: false; count: number; reason: string; noop?: true }

export const NO_CHANGE_REASON =
  'Already applied: that replacement leaves the file unchanged, so nothing was saved. Re-read the current file before issuing another edit.'

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
  // Idempotent replace: when `replace` contains `find` (a self-referential
  // "wrapping" rule), re-applying — or the model re-issuing the same edit against
  // the re-injected file — must not compound. The count guard above already caps
  // a non-`all` edit to a single bare occurrence, so this affects the same span.
  const next = overlapSafeReplaceAll(content, find, replace)
  if (next === content) return { ok: false, count, reason: NO_CHANGE_REASON, noop: true }
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
  // Edits whose find matched but changed nothing (already applied) — neither a
  // landed change nor a miss the model should retry.
  unchanged: { find: string; reason: string }[]
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
  const unchanged: { find: string; reason: string }[] = []
  for (const { find, replace, all } of edits) {
    const res = applyFindReplace(next, find, replace, all ?? false)
    if (res.ok) {
      next = res.next
      applied.push({ find, replacements: res.count })
    } else if (res.noop) {
      unchanged.push({ find, reason: res.reason })
    } else {
      failed.push({ find, reason: res.reason })
    }
  }
  return { next, applied, failed, unchanged }
}

export interface AnnotationCheck {
  /** Annotation problems the edit introduces — reject the edit. */
  errors: string[]
  /** Page-opener (hero / hero_variant) problems the edit introduces — save, but tell the admin. */
  warnings: string[]
}

// Guard a proposed edit against breaking block annotations: strip frontmatter
// and reject only problems the edit INTRODUCES (unknown id, page opener inline,
// invalid variant/theme). Legacy values already on the page (`variant: default`,
// `content-prose | variant: standard`) never block an unrelated edit. A changed
// hero / hero_variant pair that the template can't render as written is a
// warning, not an error (it falls back safely).
export function checkEditAnnotations(prevFile: string, nextFile: string): AnnotationCheck {
  const prev = splitFile(prevFile)
  const next = splitFile(nextFile)
  const errors = validateAnnotationDelta(prev.body, next.body)
  const pair = (fm: typeof prev.frontmatter) => {
    const f = fm?.fields ?? {}
    // Values are raw YAML scalars; the page opener fields are plain words.
    const bare = (raw: string | undefined) => raw?.trim().replace(/^(["'])(.*)\1$/, '$2')
    return [bare(f.hero ?? f.hero_block), bare(f.hero_variant)] as const
  }
  const [h0, v0] = pair(prev.frontmatter)
  const [h1, v1] = pair(next.frontmatter)
  const warnings = h0 === h1 && v0 === v1 ? [] : heroPairWarnings(h1, v1)
  return { errors, warnings }
}
