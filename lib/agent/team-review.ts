import type { SessionSchema } from '@/types/session-schema'

// The operator's Audit Review team decision. `remove` = member names to mark
// removed (→ teamDecision 'remove'); `add` = new members to append. `keep` is
// informational (the card sends it for completeness); teamDecision is derived
// from `remove` so the two can never disagree. Mirrors NicheReviewInput.
export type TeamAddition = { name: string; title?: string }
export type TeamReviewInput = { keep?: string[]; remove?: string[]; add?: TeamAddition[] }

type TeamMember = NonNullable<SessionSchema['team']>[number]

const norm = (s: string): string => s.trim().toLowerCase()

// Pure transform: apply a team review to the schema. Does NOT mutate its input.
// Marks each existing member kept/removed, appends net-new members, and records
// the decision in _meta.team_review. A removed member stays in the array (kept
// for read-back) but is excluded from all content via activeTeam(). Idempotent:
// teamDecision is membership-based and adds dedup, so re-applying the same review
// is a no-op beyond a refreshed timestamp. Sibling of applyNicheReview.
export function applyTeamReview(
  schema: SessionSchema,
  input: TeamReviewInput,
  reviewedAt: string,
  reviewedBy?: string,
): SessionSchema {
  const next = structuredClone(schema)
  const removeSet = new Set((input.remove ?? []).map(norm).filter(Boolean))

  const team = Array.isArray(next.team) ? next.team : []
  next.team = team

  const keepSet = new Set((input.keep ?? []).map(norm).filter(Boolean))

  const removedNames: string[] = []
  team.forEach((m) => {
    if (!m?.name) return
    const k = norm(m.name)
    if (removeSet.has(k)) m.teamDecision = 'remove'
    // A member the review doesn't mention keeps an earlier decision — a partial
    // resubmit must not silently re-keep someone removed before. A never-reviewed
    // member defaults to keep.
    else if (keepSet.has(k) || m.teamDecision !== 'remove') m.teamDecision = 'keep'
    if (m.teamDecision === 'remove') removedNames.push(m.name)
  })

  // Append net-new members the operator added, skipping any already present (by
  // name, case-insensitive) — a removed member of the same name stays removed.
  const present = new Set(team.map((m) => norm(m?.name ?? '')).filter(Boolean))
  const addedNames: string[] = []
  for (const raw of input.add ?? []) {
    const name = raw.name?.trim()
    if (!name || present.has(norm(name))) continue
    const member: TeamMember = {
      name,
      title: raw.title?.trim() ?? '',
      certifications: [],
      bio: '',
      specializations: [],
      teamDecision: 'keep',
    }
    team.push(member)
    present.add(norm(name))
    addedNames.push(name)
  }

  const keptNames = team.filter((m) => m?.teamDecision !== 'remove' && m?.name).map((m) => m.name)

  next._meta = {
    ...(next._meta ?? {
      phase3_completed_chunks: [],
      phase4_resolved_tiers: { tier1_done: false, tier2_done: false },
      phase4_flagged_for_followup: [],
      admin_overrides: {},
    }),
    team_review: {
      reviewedAt,
      kept: keptNames,
      removed: removedNames,
      added: addedNames,
      ...(reviewedBy ? { reviewedBy } : {}),
    },
  }

  return next
}
