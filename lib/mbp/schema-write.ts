// Shared schema_data write helpers. Used by the onboarding chat
// (app/api/chat), the session field editor (app/api/sessions/[id] PATCH),
// and the MBP edit chat / suggestion-apply path. Keeping a single copy
// avoids divergence between the merge semantics of those call sites.

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
    const arr = [...node]
    arr[Number(key)] = newChild
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
  return setIn(obj, path.split('.'), value) as Record<string, unknown>
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
