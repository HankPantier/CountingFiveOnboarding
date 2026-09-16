import type { SessionSchema } from '@/types/session-schema'

type Service = NonNullable<SessionSchema['services']>[number]

// The single choke point for "which services does content generation see." A
// service the operator dropped in the Phase-3 review card (status === 'dropped')
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
  return list.filter((s) => s?.status !== 'dropped')
}
