import type { GapItem } from '@/types/gap-item'

export function buildGapListInstructions(gaps: GapItem[]): string {
  // A Tier 2/3 gap the model already chose to skip (resolvedBy 'model_skip')
  // isn't re-listed, so it isn't asked again. Tier 1 skips stay listed — they
  // gate Phase 4 and need a real answer (or the "None" sentinel).
  const unresolved = gaps.filter(g => !g.resolved && !(g.resolvedBy === 'model_skip' && g.tier !== 1))
  const tier1 = unresolved.filter(g => g.tier === 1)
  const tier2 = unresolved.filter(g => g.tier === 2)
  const tier3 = unresolved.filter(g => g.tier === 3)

  const sections = [
    tier1.length
      ? `TIER 1 — MUST ASK:\n${tier1.map(g => `• ${g.label} (${g.field})`).join('\n')}`
      : '',
    tier2.length
      ? `TIER 2 — ASK IF UNDER 5 MIN:\n${tier2.map(g => `• ${g.label} (${g.field})`).join('\n')}`
      : '',
    tier3.length
      ? `TIER 3 — SKIP IF RUNNING LONG:\n${tier3.map(g => `• ${g.label} (${g.field})`).join('\n')}`
      : '',
  ].filter(Boolean)

  return sections.length ? `REMAINING GAPS:\n${sections.join('\n\n')}` : 'All gaps resolved.'
}
