// Shape coercion for stored `schema_data`. Every field here is *declared* with a
// type in SessionSchema, but the stored JSONB can carry a different shape from an
// AI draft, a notes import, a hand edit, or a bracket-path suggestion write. `??
// []` only guards null/undefined, so a dirty value slips straight through and
// TypeErrors deep inside a generator, where it surfaces as a generic "generation
// failed" note. Read dirty-able schema fields through these helpers.

// String fields that may hold an array/object. Arrays flatten to a comma list;
// anything else → ''. (Calling `.trim()` on a non-string took down BOTH the
// outline and page-body generators.)
export const str = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string').join(', ')
      : ''

// string[] fields that may hold a bare string. Symmetric with str() (arrays →
// comma string): a stray non-empty string is preserved as a single element so the
// field's content survives; anything else → []. (Client 07df2372 stored an array
// field as a string → "(t ?? []).filter is not a function" on every outline.)
export const arr = <T>(v: T[] | undefined | null): T[] => {
  if (Array.isArray(v)) return v
  const u = v as unknown
  return typeof u === 'string' && u.trim() ? ([u.trim()] as unknown as T[]) : []
}

// Object-array fields (niches, services, serviceAreas, locations, team...). Two
// failure modes in one read: a stringy value (business.serviceAreas held the
// string "Nationwide, International" → `areas.length` is truthy, so an
// `if (length)` guard passes and `.map`/`.find` throws), and null/non-object
// holes inside the array (a bracket-path write past the end leaves sparse slots
// that persist as JSONB null → `.name` of null). Mirrors the filter in
// active-niches.ts, for fields that have no active*() choke point of their own.
// Never widens a string into a fake row: a scalar can't be recovered into
// structured fields, so it degrades to [].
export const objArr = <T>(v: unknown): T[] =>
  Array.isArray(v) ? v.filter((x): x is T => !!x && typeof x === 'object') : []
