// Shared schema_data write helpers. Used by the onboarding chat
// (app/api/chat), the session field editor (app/api/sessions/[id] PATCH),
// and the MBP edit chat / suggestion-apply path. Keeping a single copy
// avoids divergence between the merge semantics of those call sites.

// Set a dotted path (e.g. "business.tagline") on a nested object,
// returning a new object. Intermediate objects are created/cloned as needed.
export function deepSetPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const keys = path.split('.')
  const result = { ...obj }
  let current = result
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    current[key] = {
      ...(typeof current[key] === 'object' && current[key] !== null && !Array.isArray(current[key])
        ? (current[key] as Record<string, unknown>)
        : {}),
    }
    current = current[key] as Record<string, unknown>
  }
  current[keys[keys.length - 1]] = value
  return result
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
