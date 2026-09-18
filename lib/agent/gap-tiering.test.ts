import { describe, expect, it } from 'vitest'
import { tierGapsByTreatment } from './gap-tiering'
import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'

const niche = (name: string, pageTreatment?: 'page' | 'block' | 'exclude') =>
  ({ name, description: '', icp: '', painPoints: '', valueProp: '', ...(pageTreatment ? { pageTreatment } : {}) })
const service = (name: string, pageTreatment?: 'page' | 'block' | 'exclude') =>
  ({ name, description: '', offerings: [], ...(pageTreatment ? { pageTreatment } : {}) })

const gaps = (): GapItem[] => [
  { field: 'niches[0].painPoints', label: '', phase: 4, tier: 1, resolved: false },
  { field: 'niches[0].valueProp', label: '', phase: 4, tier: 1, resolved: false },
  { field: 'niches[0].keywords', label: '', phase: 4, tier: 2, resolved: false },
  { field: 'niches[1].painPoints', label: '', phase: 4, tier: 1, resolved: false },
  { field: 'services[0].description', label: '', phase: 4, tier: 1, resolved: false },
  { field: 'services[0].keywords', label: '', phase: 4, tier: 2, resolved: false },
  { field: 'business.foundingYear', label: '', phase: 4, tier: 1, resolved: false },
]

describe('tierGapsByTreatment', () => {
  it('drops page-only gaps for block items, keeps the essence + page items + firm gaps', () => {
    const schema = { niches: [niche('A', 'block'), niche('B', 'page')], services: [service('S', 'block')] } as SessionSchema
    const out = tierGapsByTreatment(schema, gaps()).map((g) => g.field)
    expect(out).not.toContain('niches[0].painPoints') // deep persona dropped for block
    expect(out).not.toContain('niches[0].keywords')
    expect(out).toContain('niches[0].valueProp') // essence kept
    expect(out).toContain('niches[1].painPoints') // page niche keeps everything
    expect(out).not.toContain('services[0].keywords') // block service deep dropped
    expect(out).toContain('services[0].description') // essence kept
    expect(out).toContain('business.foundingYear') // firm-level untouched
  })

  it('returns the same array when nothing is a block', () => {
    const schema = { niches: [niche('A', 'page')], services: [service('S')] } as SessionSchema
    const g = gaps()
    expect(tierGapsByTreatment(schema, g)).toBe(g)
  })
})
