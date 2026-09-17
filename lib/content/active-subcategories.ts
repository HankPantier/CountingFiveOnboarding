import type { SessionSchema } from '@/types/session-schema'

type Niche = NonNullable<SessionSchema['niches']>[number]
type SubCategory = NonNullable<Niche['subCategories']>[number]

// The single choke point for "which sub-services content generation sees." A
// sub-service the operator dropped in the Phase-3 review card (status ===
// 'dropped') stays in niche.subCategories for auditability + read-back, but must
// never reach any generator. Missing status is treated as active (legacy
// sessions are unaffected). No generator consumes sub-services today; this is the
// primitive future consumers must route through, mirroring activeNiches().
export function activeSubCategories(niche: Pick<Niche, 'subCategories'>): SubCategory[] {
  const list = niche.subCategories
  if (!Array.isArray(list)) return []
  return list.filter((s) => s?.status !== 'dropped')
}
