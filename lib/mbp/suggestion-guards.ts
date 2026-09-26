import { getByPath } from '@/lib/mbp/schema-write'
import type { MbpSuggestionBase, MbpSuggestionChange } from '@/types/mbp'

// Pure policy for which MBP suggestion paths may be filed/approved, and for the
// staleness guard that keeps an old whole-array suggestion from clobbering
// newer data. Shared by insertMbpSuggestion (filing) and the approve route.

// The valid top-level segments of SessionSchema that a suggestion may write.
// A path outside this set can only create an orphaned top-level key the MBP UI
// never renders. `_meta` is deliberately absent: it holds server-owned gate
// markers and mode flags (niche_review, mode, admin_overrides, …) that no AI
// suggestion may set.
const APPROVABLE_TOP_LEVEL = new Set([
  'contact', 'websiteUrl', 'technical', 'locations', 'team', 'services',
  'clientPortals', 'niches', 'business', 'culture', 'brand', 'assets', 'additional',
  'proposed_sitemap', 'current_sitemap', 'socialPresence', 'reputation',
  'content_gaps', 'content_direction',
])

// Exact `_meta.*` paths a suggestion may target. Empty today — add a path here
// only after confirming it isn't a phase gate, mode flag or audit marker.
const APPROVABLE_META_PATHS = new Set<string>()

function topSegment(fieldPath: string): string {
  return fieldPath.split(/[.[]/)[0]
}

export function isApprovableSuggestionPath(fieldPath: string): boolean {
  const top = topSegment(fieldPath)
  if (top === '_meta') return APPROVABLE_META_PATHS.has(fieldPath)
  return APPROVABLE_TOP_LEVEL.has(top)
}

// A `set` that replaces a whole array (the proposed or the current value is a
// list). Approving one built from an old snapshot would silently drop every
// entry added or changed since, so these always carry a base snapshot.
export function isWholeArraySet(op: string | undefined, proposedValue: unknown, currentValue: unknown): boolean {
  return op !== 'append' && (Array.isArray(proposedValue) || Array.isArray(currentValue))
}

// Order-insensitive structural equality for JSON values (jsonb reorders keys).
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao).filter(k => ao[k] !== undefined)
  const bk = Object.keys(bo).filter(k => bo[k] !== undefined)
  return ak.length === bk.length && ak.every(k => jsonEqual(ao[k], bo[k]))
}

// The snapshot a change must still match at approval time, or null when the
// change is unguarded. New suggestions carry an explicit `base`; older
// whole-array sets fall back to the `currentValue` recorded when filed.
export function suggestionBaseFor(
  fieldPath: string,
  change: MbpSuggestionChange,
  schema: Record<string, unknown>
): MbpSuggestionBase | null {
  if (change.base && typeof change.base.path === 'string') return change.base
  if (
    'currentValue' in change &&
    isWholeArraySet(change.op, change.proposedValue, change.currentValue ?? getByPath(schema, fieldPath))
  ) {
    return { path: fieldPath, value: change.currentValue ?? null }
  }
  return null
}

// True when the live value at the guard's path no longer matches the snapshot.
export function isBaseStale(base: MbpSuggestionBase, schema: Record<string, unknown>): boolean {
  return !jsonEqual(getByPath(schema, base.path) ?? null, base.value ?? null)
}
