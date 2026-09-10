import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'

// The operator's Phase-3 niche keep/drop review. `drop` = detected-niche names to
// mark dropped; `add` = high-opportunity niche names to add as served niches.
// `keep` is informational (the card sends it for completeness); status is derived
// from `drop` so the two can never disagree.
export type NicheReviewInput = { keep?: string[]; drop?: string[]; add?: string[] }

const norm = (s: string): string => s.trim().toLowerCase()

// Pure transform: apply a niche review to the schema + gap list. Does NOT mutate
// its inputs. Marks each existing niche kept/dropped, appends net-new niches,
// mirrors dropped names into business.contentExclusions (belt-and-suspenders on
// top of the activeNiches status filter), prunes the dropped niches' Phase-4
// gaps, and records the decision in _meta.niche_review. Idempotent: status is
// membership-based and adds/exclusions dedup, so re-applying the same review is a
// no-op beyond a refreshed timestamp.
export function applyNicheReview(
  schema: SessionSchema,
  gaps: GapItem[],
  input: NicheReviewInput,
  reviewedAt: string,
  reviewedBy?: string,
): { schema: SessionSchema; gaps: GapItem[] } {
  const next = structuredClone(schema)
  const dropSet = new Set((input.drop ?? []).map(norm).filter(Boolean))

  const niches = Array.isArray(next.niches) ? next.niches : []
  next.niches = niches

  const droppedNames: string[] = []
  const droppedIndexes = new Set<number>()
  niches.forEach((n, i) => {
    if (!n?.name) return
    if (dropSet.has(norm(n.name))) {
      n.status = 'dropped'
      droppedNames.push(n.name)
      droppedIndexes.add(i)
    } else {
      n.status = 'kept'
    }
  })

  // Append net-new niches the operator added, skipping any already present
  // (by name, case-insensitive) — a dropped niche of the same name stays dropped.
  const present = new Set(niches.map((n) => norm(n?.name ?? '')).filter(Boolean))
  const addedNames: string[] = []
  for (const raw of input.add ?? []) {
    const name = raw.trim()
    if (!name || present.has(norm(name))) continue
    niches.push({ name, description: '', icp: '', painPoints: '', valueProp: '', status: 'kept' })
    present.add(norm(name))
    addedNames.push(name)
  }

  // Mirror dropped names into contentExclusions (dedup). Only when a business
  // object exists — the status filter is the primary exclusion mechanism.
  if (next.business && droppedNames.length) {
    const existing = next.business.contentExclusions ?? []
    const seen = new Set(existing.map(norm))
    const additions = droppedNames.filter((n) => !seen.has(norm(n)))
    if (additions.length) next.business.contentExclusions = [...existing, ...additions]
  }

  // Prune Phase-4 gaps belonging to a dropped niche (niches[i].*). Index stays
  // stable because dropped niches remain in the array.
  const prunedGaps =
    droppedIndexes.size === 0
      ? gaps.map((g) => ({ ...g }))
      : gaps.filter((g) => {
          const m = /^niches\[(\d+)\]/.exec(g.field)
          return !(m && droppedIndexes.has(Number(m[1])))
        })

  const keptNames = niches.filter((n) => n?.status !== 'dropped' && n?.name).map((n) => n.name)

  next._meta = {
    ...(next._meta ?? {
      phase3_completed_chunks: [],
      phase4_resolved_tiers: { tier1_done: false, tier2_done: false },
      phase4_flagged_for_followup: [],
      admin_overrides: {},
    }),
    niche_review: {
      reviewedAt,
      kept: keptNames,
      dropped: droppedNames,
      added: addedNames,
      ...(reviewedBy ? { reviewedBy } : {}),
    },
  }

  return { schema: next, gaps: prunedGaps }
}
