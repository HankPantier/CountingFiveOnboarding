import type { GapItem } from '@/types/gap-item'

export function buildGapListInstructions(gaps: GapItem[]): string {
  const unresolved = gaps.filter(g => !g.resolved)
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
