import type { SessionSchema } from '@/types/session-schema'
import { arr } from '@/lib/content/schema-coerce'

const norm = (s: string): string => s.trim().toLowerCase()

// Mirrors dropped niche + service names into business.contentExclusions
// (belt-and-suspenders on top of the activeNiches/activeServices status filters)
// and keeps that mirror reversible.
//
// The names this helper itself added are tracked in `_meta.review_exclusions`.
// On every review apply the desired set is recomputed from the CURRENT dropped
// niches/services, so an item that was dropped and later kept again has its
// review-added exclusion removed. Exclusions the operator/client typed
// themselves are never touched (they're not in the tracked list), and a name
// that was already present before the review added it is not claimed.
//
// Sub-service names are deliberately NOT mirrored: they're scoped to one niche
// ("Payroll" under Dental), and a global exclusion would ban the topic
// firm-wide. The subCategories status filter handles them.
//
// Mutates `next` (callers pass their structuredClone). Tolerates a stringy
// stored contentExclusions (coerced via arr()).
export function syncReviewExclusions(next: SessionSchema): void {
  if (!next.business) return

  const desired: string[] = []
  const desiredKeys = new Set<string>()
  const pushDropped = (items: unknown) => {
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== 'object') continue
      const { name, status } = item as { name?: unknown; status?: unknown }
      if (status !== 'dropped' || typeof name !== 'string' || !name.trim()) continue
      if (desiredKeys.has(norm(name))) continue
      desiredKeys.add(norm(name))
      desired.push(name)
    }
  }
  pushDropped(next.niches)
  pushDropped(next.services)

  const meta = (next._meta ?? {}) as { review_exclusions?: unknown }
  const tracked = new Set(
    arr(meta.review_exclusions as string[] | undefined)
      .filter((s): s is string => typeof s === 'string')
      .map(norm)
  )

  const existing = arr(next.business.contentExclusions).filter(
    (s): s is string => typeof s === 'string'
  )
  // Drop review-added entries whose item is no longer dropped.
  const kept = existing.filter((s) => !(tracked.has(norm(s)) && !desiredKeys.has(norm(s))))
  const keptKeys = new Set(kept.map(norm))

  const nextTracked: string[] = []
  const additions: string[] = []
  for (const name of desired) {
    const k = norm(name)
    if (!keptKeys.has(k)) {
      additions.push(name)
      nextTracked.push(name)
    } else if (tracked.has(k)) {
      // Still ours from an earlier review.
      nextTracked.push(name)
    }
  }

  if (additions.length > 0 || kept.length !== existing.length) {
    next.business.contentExclusions = [...kept, ...additions]
  }

  if (nextTracked.length > 0 || tracked.size > 0) {
    next._meta = {
      ...(next._meta ?? {
        phase3_completed_chunks: [],
        phase4_resolved_tiers: { tier1_done: false, tier2_done: false },
        phase4_flagged_for_followup: [],
        admin_overrides: {},
      }),
      review_exclusions: nextTracked,
    }
  }
}
