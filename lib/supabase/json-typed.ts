import type { Json } from '@/types/database'

// Supabase's Json type is recursive and structural; TypeScript can't always
// prove that a known-good structured value (arrays of records, etc.) satisfies
// it without help. Use this helper at the call site to centralize the
// intent — "I'm asserting this is JSON-serializable" — and to make it
// grep-able when the project ever adopts a stricter check.
//
// Prefer over `as unknown as Json`.
export function asJson<T>(value: T): Json {
  return value as unknown as Json
}
