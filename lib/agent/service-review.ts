import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'

// A per-service page-vs-block decision + audit source from the Audit Review step.
// Mirrors NicheTreatment: 'exclude' folds into the drop set; 'page'/'block' are
// stamped onto the kept service; `parent` records the block attachment; `origin`
// records the two-batch source.
export type ServiceTreatment = {
  name: string
  pageTreatment: 'page' | 'block' | 'exclude'
  parent?: string
  origin?: 'site' | 'audit'
}

// The operator's service keep/drop review. `drop` = detected-service names to
// mark dropped; `add` = new service names to append. `keep` is informational
// (the card sends it for completeness); status is derived from `drop` (+ any
// 'exclude' treatments) so they can never disagree. `treatments` is the richer
// Audit Review payload; the legacy in-chat card omits it. Mirrors NicheReviewInput.
export type ServiceReviewInput = {
  keep?: string[]
  drop?: string[]
  add?: string[]
  treatments?: ServiceTreatment[]
}

const norm = (s: string): string => s.trim().toLowerCase()

// Pure transform: apply a service review to the schema + gap list. Does NOT mutate
// its inputs. Marks each existing service kept/dropped, appends net-new services,
// mirrors dropped names into business.contentExclusions (belt-and-suspenders on
// top of the activeServices status filter), prunes the dropped services' Phase-4
// gaps, and records the decision in _meta.services_review. Idempotent: status is
// membership-based and adds/exclusions dedup, so re-applying the same review is a
// no-op beyond a refreshed timestamp. Sibling of applyNicheReview.
export function applyServiceReview(
  schema: SessionSchema,
  gaps: GapItem[],
  input: ServiceReviewInput,
  reviewedAt: string,
  reviewedBy?: string,
): { schema: SessionSchema; gaps: GapItem[] } {
  const next = structuredClone(schema)
  const treatmentMap = new Map((input.treatments ?? []).map((t) => [norm(t.name), t]))
  const dropSet = new Set((input.drop ?? []).map(norm).filter(Boolean))
  for (const t of input.treatments ?? []) {
    if (t.pageTreatment === 'exclude') dropSet.add(norm(t.name))
  }

  const services = Array.isArray(next.services) ? next.services : []
  next.services = services

  const droppedNames: string[] = []
  const droppedIndexes = new Set<number>()
  services.forEach((s, i) => {
    if (!s?.name) return
    const k = norm(s.name)
    const t = treatmentMap.get(k)
    if (t?.origin) s.origin = t.origin
    if (dropSet.has(k)) {
      s.status = 'dropped'
      droppedNames.push(s.name)
      droppedIndexes.add(i)
    } else {
      s.status = 'kept'
      if (t && t.pageTreatment !== 'exclude') {
        s.pageTreatment = t.pageTreatment
        if (t.pageTreatment === 'block' && t.parent) s.parent = t.parent
        else delete s.parent
      }
    }
  })

  // Append net-new services the operator added, skipping any already present
  // (by name, case-insensitive) — a dropped service of the same name stays dropped.
  const present = new Set(services.map((s) => norm(s?.name ?? '')).filter(Boolean))
  const addedNames: string[] = []
  for (const raw of input.add ?? []) {
    const name = raw.trim()
    if (!name || present.has(norm(name))) continue
    const t = treatmentMap.get(norm(name))
    services.push({
      name, description: '', offerings: [], status: 'kept',
      ...(t?.origin ? { origin: t.origin } : {}),
      ...(t && t.pageTreatment !== 'exclude' ? { pageTreatment: t.pageTreatment } : {}),
      ...(t && t.pageTreatment === 'block' && t.parent ? { parent: t.parent } : {}),
    })
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

  // Prune Phase-4 gaps belonging to a dropped service (services[i].*). Index stays
  // stable because dropped services remain in the array.
  const prunedGaps =
    droppedIndexes.size === 0
      ? gaps.map((g) => ({ ...g }))
      : gaps.filter((g) => {
          const m = /^services\[(\d+)\]/.exec(g.field)
          return !(m && droppedIndexes.has(Number(m[1])))
        })

  const keptNames = services.filter((s) => s?.status !== 'dropped' && s?.name).map((s) => s.name)

  next._meta = {
    ...(next._meta ?? {
      phase3_completed_chunks: [],
      phase4_resolved_tiers: { tier1_done: false, tier2_done: false },
      phase4_flagged_for_followup: [],
      admin_overrides: {},
    }),
    services_review: {
      reviewedAt,
      kept: keptNames,
      dropped: droppedNames,
      added: addedNames,
      ...(reviewedBy ? { reviewedBy } : {}),
    },
  }

  return { schema: next, gaps: prunedGaps }
}
