import type { SessionSchema } from '@/types/session-schema'

type Niche = NonNullable<SessionSchema['niches']>[number]

// The single choke point for "which niches does content generation see." A niche
// the operator dropped in the Phase-3 review card (status === 'dropped') is kept
// in schema.niches for auditability + stable niches[i] gap-path indexes, but must
// never reach any generator. Every content-gen read of schema.niches goes through
// here instead. Missing status = active (legacy sessions are unaffected).
//
// Deliberately excluded (do NOT route through this helper):
//  - lib/mbp-parser addPhase4Gaps — iterates by real index and `continue`s on
//    dropped, so kept niches keep their original niches[i] path.
//  - lib/mbp/build-document — shows dropped niches with a "(DROPPED)" marker for
//    the operator read-back, so it must see the full array.
export function activeNiches(schema: Pick<SessionSchema, 'niches'>): Niche[] {
  const list = schema.niches
  if (!Array.isArray(list)) return []
  // Drop null / non-object holes too: a bracket-path write to a shorter array
  // leaves undefined slots that persist as null in JSONB. The stored array keeps
  // its indices (gap-path stability), but a null must never reach a generator.
  return list.filter((n): n is Niche => !!n && typeof n === 'object' && n.status !== 'dropped')
}
