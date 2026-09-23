import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'
import { syncReviewExclusions } from './review-exclusions'

// A per-niche page-vs-block decision + audit source from the Audit Review step.
// `pageTreatment: 'exclude'` is folded into the drop set (equivalent to a legacy
// drop); 'page'/'block' are stamped onto the kept niche; `parent` records the
// operator-picked block attachment; `origin` records the two-batch source.
export type NicheTreatment = {
  name: string
  pageTreatment: 'page' | 'block' | 'exclude'
  parent?: string
  origin?: 'site' | 'audit'
}

// The operator's niche keep/drop review. `drop` = detected-niche names to mark
// dropped; `add` = high-opportunity niche names to add as served niches. `keep`
// is informational (the card sends it for completeness); status is derived from
// `drop` (+ any 'exclude' treatments) so they can never disagree. `treatments`
// is the richer Audit Review payload; the legacy in-chat card omits it and this
// stays a pure keep/drop.
export type NicheReviewInput = {
  keep?: string[]
  drop?: string[]
  add?: string[]
  treatments?: NicheTreatment[]
}

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
  const treatmentMap = new Map((input.treatments ?? []).map((t) => [norm(t.name), t]))
  const dropSet = new Set((input.drop ?? []).map(norm).filter(Boolean))
  const keepSet = new Set((input.keep ?? []).map(norm).filter(Boolean))
  // An 'exclude' treatment is a drop — fold it in so status/gap/exclusion handling
  // is identical to a legacy drop.
  for (const t of input.treatments ?? []) {
    if (t.pageTreatment === 'exclude') dropSet.add(norm(t.name))
  }

  const niches = Array.isArray(next.niches) ? next.niches : []
  next.niches = niches

  const droppedNames: string[] = []
  const droppedIndexes = new Set<number>()
  niches.forEach((n, i) => {
    if (!n?.name) return
    const k = norm(n.name)
    const t = treatmentMap.get(k)
    if (t?.origin) n.origin = t.origin
    // An item the review doesn't mention (not dropped, not kept, no treatment)
    // keeps its existing decision — a partial resubmit must not silently re-keep
    // something dropped earlier. A never-reviewed item defaults to kept.
    const explicitKeep = keepSet.has(k) || (!!t && t.pageTreatment !== 'exclude')
    if (dropSet.has(k)) {
      n.status = 'dropped'
    } else if (explicitKeep || n.status !== 'dropped') {
      n.status = 'kept'
      // Stamp the page-vs-block decision on kept items. 'page' clears any prior
      // block parent; 'block' records the operator-picked parent.
      if (t && t.pageTreatment !== 'exclude') {
        n.pageTreatment = t.pageTreatment
        if (t.pageTreatment === 'block' && t.parent) n.parent = t.parent
        else delete n.parent
      }
    }
    if (n.status === 'dropped') {
      droppedNames.push(n.name)
      droppedIndexes.add(i)
    }
  })

  // Append net-new niches the operator added, skipping any already present
  // (by name, case-insensitive) — a dropped niche of the same name stays dropped.
  const present = new Set(niches.map((n) => norm(n?.name ?? '')).filter(Boolean))
  const addedNames: string[] = []
  for (const raw of input.add ?? []) {
    const name = raw.trim()
    if (!name || present.has(norm(name))) continue
    const t = treatmentMap.get(norm(name))
    niches.push({
      name, description: '', icp: '', painPoints: '', valueProp: '', status: 'kept',
      ...(t?.origin ? { origin: t.origin } : {}),
      ...(t && t.pageTreatment !== 'exclude' ? { pageTreatment: t.pageTreatment } : {}),
      ...(t && t.pageTreatment === 'block' && t.parent ? { parent: t.parent } : {}),
    })
    present.add(norm(name))
    addedNames.push(name)
  }

  // Mirror dropped niche/service names into contentExclusions, recomputed from
  // the current statuses so a re-kept item's review-added exclusion is removed
  // (see syncReviewExclusions). The status filter is the primary mechanism.
  syncReviewExclusions(next)

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
