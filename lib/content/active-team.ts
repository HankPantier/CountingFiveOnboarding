import type { SessionSchema } from '@/types/session-schema'

type TeamMember = NonNullable<SessionSchema['team']>[number]

// The single choke point for "which team members content generation sees." A
// member the operator removed in the Audit Review team step (teamDecision ===
// 'remove') stays in schema.team for auditability + read-back, but must never
// reach any generator, the published team page, or JSON-LD. Every content-gen
// read of schema.team goes through here instead. Missing teamDecision = active
// (legacy sessions are unaffected). Sibling of activeNiches / activeServices.
//
// Deliberately excluded (do NOT route through this helper):
//  - lib/mbp/build-document — shows removed members for the operator read-back,
//    so it must see the full array.
export function activeTeam(schema: Pick<SessionSchema, 'team'>): TeamMember[] {
  const list = schema.team
  if (!Array.isArray(list)) return []
  // Null / non-object holes (bracket-path writes that persist as JSONB null) are
  // dropped here too — stored indices stay stable, but no generator sees a null.
  // A row with no usable name is unusable by every consumer downstream — it
  // cannot be written about, rendered, or matched — and is what a stale-index
  // bracket write leaves behind next to the real rows. Drop it here so the
  // orphan can stay in the stored array for the operator to review (the MBP
  // read-back deliberately bypasses this helper and still shows it).
  return list.filter(
    (t): t is TeamMember =>
      !!t && typeof t === 'object' && t.teamDecision !== 'remove' && typeof t.name === 'string' && t.name.trim().length > 0
  )
}
