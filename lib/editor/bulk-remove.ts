// Whole-file bulk removal/replacement for the AI content editor's remove_text
// tool. Unlike apply_edit (one exact snippet), this removes EVERY occurrence of
// each phrase across the entire file — frontmatter (SEO fields) and body alike —
// in a single pass, so a "remove all references to X, Y, Z" request lands in one
// commit instead of many brittle find/replace calls. Pure and deterministic.
import { humanizeDashes } from '@/lib/content/anti-slop-validator'

export interface Removal {
  find: string
  replace?: string
}

export interface RemovalCount {
  find: string
  removed: number
}

export interface ResidualCount {
  find: string
  remaining: number
}

export interface BulkRemoveResult {
  next: string
  applied: RemovalCount[] // per find, how many occurrences were removed (0 = not found)
  dashesStripped: number
  residual: ResidualCount[] // per find, occurrences still present after the pass (should be 0)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Count non-overlapping occurrences of `find` in `text`.
export function countPhrase(text: string, find: string, caseInsensitive = false): number {
  if (!find) return 0
  if (!caseInsensitive) return text.split(find).length - 1
  return (text.match(new RegExp(escapeRegExp(find), 'gi')) || []).length
}

// Literal replace-all. `replace` is inserted verbatim (the function form of
// String.replace avoids `$&`/`$1` being interpreted as substitution patterns).
function replaceAll(text: string, find: string, replace: string, caseInsensitive: boolean): string {
  if (!find) return text
  if (!caseInsensitive) return text.split(find).join(replace)
  return text.replace(new RegExp(escapeRegExp(find), 'gi'), () => replace)
}

const countDashLike = (s: string): number => (s.match(/[—–]/g) || []).length

export function applyBulkRemovals(
  content: string,
  removals: Removal[],
  opts: { caseInsensitive?: boolean; stripDashes?: boolean } = {}
): BulkRemoveResult {
  const caseInsensitive = opts.caseInsensitive ?? false
  const applied: RemovalCount[] = []
  let next = content

  for (const { find, replace } of removals) {
    if (!find || find.trim() === '') {
      applied.push({ find, removed: 0 })
      continue
    }
    const removed = countPhrase(next, find, caseInsensitive)
    if (removed > 0) next = replaceAll(next, find, replace ?? '', caseInsensitive)
    applied.push({ find, removed })
  }

  let dashesStripped = 0
  if (opts.stripDashes) {
    // Difference before/after captures exactly what humanizeDashes converted:
    // em-dashes and word-boundary en-dashes drop, numeric ranges and dashes
    // inside protected code fences / block annotations stay.
    const before = countDashLike(next)
    next = humanizeDashes(next)
    dashesStripped = before - countDashLike(next)
  }

  const residual: ResidualCount[] = removals
    .filter((r) => r.find && r.find.trim() !== '')
    .map((r) => ({ find: r.find, remaining: countPhrase(next, r.find, caseInsensitive) }))
    .filter((r) => r.remaining > 0)

  return { next, applied, dashesStripped, residual }
}
