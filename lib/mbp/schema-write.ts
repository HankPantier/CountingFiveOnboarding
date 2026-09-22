// Shared schema_data write helpers. Used by the onboarding chat
// (app/api/chat), the session field editor (app/api/sessions/[id] PATCH),
// and the MBP edit chat / suggestion-apply path. Keeping a single copy
// avoids divergence between the merge semantics of those call sites.

// Split a field path into segments, normalizing bracket array indices to
// dot-index form so `niches[3].description` and `niches.3.description` parse
// identically. Without this, `split('.')` leaves `niches[3]` as one literal
// segment and every writer creates a junk top-level key named "niches[3]"
// instead of updating the array element. Single source of truth for all three
// helpers below (the AI's suggestion tools emit bracket notation constantly).
function toSegments(path: string): string[] {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
}

// Set a dotted path on a nested structure, returning a new structure.
// Numeric path segments are treated as array indices (e.g. "team.3.bio"),
// so array entries are updated in place rather than clobbering the array.
// Intermediate nodes are created (array if the next segment is numeric, else
// object) and cloned immutably.
function setIn(node: unknown, keys: string[], value: unknown): unknown {
  const [key, ...rest] = keys
  const leaf = rest.length === 0
  const existingChild =
    node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined
  const newChild = leaf
    ? value
    : setIn(existingChild ?? (/^\d+$/.test(rest[0]) ? [] : {}), rest, value)

  if (Array.isArray(node)) {
    const idx = Number(key)
    const arr = [...node]
    arr[idx] = newChild
    // Assigning past the end leaves SPARSE slots, which Postgres persists as
    // JSONB `null` — and a null element later throws on `.name` deep inside a
    // generator (the Berg Advisors session had three). Fill any gap this write
    // opened with an empty object so the array is never holed. Callers that can
    // tell a stale index from a legitimate one reject it up front via
    // outOfRangeIndexPath(); setIn also builds fresh nested objects from a bare
    // {} (app/api/chat/route.ts), where an index is not "out of range" at all.
    for (let i = 0; i < arr.length; i++) if (!(i in arr)) arr[i] = {}
    return arr
  }
  const base = node && typeof node === 'object' ? (node as Record<string, unknown>) : {}
  return { ...base, [key]: newChild }
}

export function deepSetPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  return setIn(obj, toSegments(path), value) as Record<string, unknown>
}

// Read a dotted path, traversing both object keys and numeric array indices
// (e.g. "business.tagline", "team.3.title"). Returns undefined if any segment
// is missing.
export function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return toSegments(path).reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined
    if (Array.isArray(acc)) {
      const idx = Number(key)
      return Number.isInteger(idx) ? acc[idx] : undefined
    }
    return (acc as Record<string, unknown>)[key]
  }, obj)
}

// True when a dotted/bracketed path resolves to a non-empty value. Mirrors the
// gap "is this filled?" semantics: empty string / null / [] count as unfilled,
// and a default `false` boolean is NOT a real answer (so boolean gaps resolve
// only via an explicit signal, never auto-fill). Accepts both `niches[0].x` and
// `niches.0.x` forms.
export function isPathFilled(obj: unknown, path: string): boolean {
  const parts = toSegments(path)
  let cur: unknown = obj
  for (const p of parts) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[p]
    else return false
  }
  if (cur === undefined || cur === null) return false
  if (typeof cur === 'string') return cur.trim().length > 0
  if (Array.isArray(cur)) return cur.length > 0
  if (typeof cur === 'boolean') return false
  return true
}

// Recursively merge source into target. Plain objects merge deeply; arrays
// and primitives replace.
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const sv = source[key]
    const tv = target[key]
    if (
      typeof sv === 'object' && !Array.isArray(sv) && sv !== null &&
      typeof tv === 'object' && !Array.isArray(tv) && tv !== null
    ) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>)
    } else {
      result[key] = sv
    }
  }
  return result
}

// deepMerge REPLACES arrays wholesale, but `_meta.phase3_completed_chunks` is an
// append-only set of step markers that gate Phase 3 advancement. A model update
// that resends the array missing an earlier marker (the prompt only shows
// `[..., "chunkX"]`) would otherwise silently re-open a cleared gate and strand
// the session. Re-union the pre-merge markers into the merged schema so a marker
// can only ever be added, never dropped. Mutates and returns `merged`.
export function preserveAppendOnlyMarkers(
  before: Record<string, unknown>,
  merged: Record<string, unknown>
): Record<string, unknown> {
  const prev = (before._meta as { phase3_completed_chunks?: unknown } | undefined)
    ?.phase3_completed_chunks
  const mergedMeta = merged._meta as { phase3_completed_chunks?: unknown } | undefined
  if (mergedMeta && Array.isArray(prev)) {
    const next = Array.isArray(mergedMeta.phase3_completed_chunks)
      ? mergedMeta.phase3_completed_chunks
      : []
    mergedMeta.phase3_completed_chunks = Array.from(
      new Set([...(prev as unknown[]), ...(next as unknown[])])
    )
  }
  return merged
}

// True-path check for writers applying a path against the stored schema: returns
// the offending `array[index]` segment when the path addresses an array slot
// beyond the end of the array that is actually there. That only happens when the
// index is stale — an AI suggestion approved after the array shrank — and
// applying it would bury an orphan row with no identity at a meaningless index
// (the Berg Advisors session collected three that way). Appending one past the
// end is legitimate and passes.
export function outOfRangeIndexPath(obj: Record<string, unknown>, path: string): string | null {
  const parts = toSegments(path)
  let cur: unknown = obj
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]
    if (Array.isArray(cur)) {
      const idx = Number(seg)
      if (!Number.isInteger(idx) || idx < 0 || idx > cur.length) {
        return `${parts.slice(0, i).join('.')}[${seg}]`
      }
    }
    if (cur == null || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[seg]
  }
  return null
}
