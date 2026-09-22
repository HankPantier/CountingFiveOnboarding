import type { SessionSchema } from '@/types/session-schema'

type Service = NonNullable<SessionSchema['services']>[number]

// The single choke point for "which services does content generation see." A
// service the operator dropped in the Audit Review step (status === 'dropped')
// is kept in schema.services for auditability + stable services[i] gap-path
// indexes, but must never reach any generator. Every content-gen read of
// schema.services goes through here instead. Missing status = active (legacy
// sessions are unaffected). Sibling of activeNiches.
//
// Deliberately excluded (do NOT route through this helper):
//  - lib/mbp-parser addPhase4Gaps — iterates by real index and `continue`s on
//    dropped, so kept services keep their original services[i] path.
//  - lib/mbp/build-document — shows dropped services with a "(DROPPED)" marker for
//    the operator read-back, so it must see the full array.
export function activeServices(schema: Pick<SessionSchema, 'services'>): Service[] {
  const list = schema.services
  if (!Array.isArray(list)) return []
  // Null / non-object holes (bracket-path writes that persist as JSONB null) are
  // dropped here too — stored indices stay stable, but no generator sees a null.
  // A row with no usable name is unusable by every consumer downstream — it
  // cannot be written about, rendered, or matched — and is what a stale-index
  // bracket write leaves behind next to the real rows. Drop it here so the
  // orphan can stay in the stored array for the operator to review (the MBP
  // read-back deliberately bypasses this helper and still shows it).
  return list.filter(
    (s): s is Service =>
      !!s && typeof s === 'object' && s.status !== 'dropped' && typeof s.name === 'string' && s.name.trim().length > 0
  )
}
