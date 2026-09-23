import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'
import { computePhase4Gaps } from '@/lib/mbp-parser'

// Content-BLOCK items render as a short section on a parent page, not their own
// URL — so the deep, page-grade gaps below are dropped for them, keeping the
// Phase-4 Q&A focused on the pages that actually get built. The one-line essence
// (niches[i].valueProp, services[i].description) is intentionally NOT listed, so a
// block section still has substance. Excluded items are already gap-free (the
// apply-helpers prune them). Page items keep everything.
const NICHE_PAGE_ONLY = new Set(['painPoints', 'customerTrigger', 'keywords', 'decisionMaker', 'businessStage', 'revenueBand', 'nicheOrigin'])
const SERVICE_PAGE_ONLY = new Set(['keywords', 'offerings'])

// Drop the page-only gaps for any niche/service the operator marked as a content
// block. Pure; returns a new array (the original when nothing is a block).
export function tierGapsByTreatment(schema: SessionSchema, gaps: GapItem[]): GapItem[] {
  const blockNiche = new Set<number>()
  ;(schema.niches ?? []).forEach((n, i) => { if (n && typeof n === 'object' && n.pageTreatment === 'block') blockNiche.add(i) })
  const blockService = new Set<number>()
  ;(schema.services ?? []).forEach((s, i) => { if (s && typeof s === 'object' && s.pageTreatment === 'block') blockService.add(i) })
  if (!blockNiche.size && !blockService.size) return gaps

  return gaps.filter((g) => {
    const n = /^niches\[(\d+)\]\.(\w+)$/.exec(g.field)
    if (n && blockNiche.has(Number(n[1])) && NICHE_PAGE_ONLY.has(n[2])) return false
    const s = /^services\[(\d+)\]\.(\w+)$/.exec(g.field)
    if (s && blockService.has(Number(s[1])) && SERVICE_PAGE_ONLY.has(s[2])) return false
    return true
  })
}

const normField = (f: string): string => f.replace(/\[(\d+)\]/g, '.$1')

// Gaps are computed once at session creation, so a niche/service added later
// (Audit Review, notes extraction) never got its Phase-4 depth gaps. Append the
// freshly computed gaps whose field isn't already tracked (resolved or not),
// then re-apply the page/block tiering. Pure.
export function refreshPhase4Gaps(schema: SessionSchema, gaps: GapItem[]): GapItem[] {
  const tracked = new Set(gaps.map((g) => normField(g.field)))
  const additions = computePhase4Gaps(schema).filter((g) => !tracked.has(normField(g.field)))
  return tierGapsByTreatment(schema, additions.length ? [...gaps, ...additions] : gaps)
}
