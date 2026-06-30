import { describe, expect, it } from 'vitest'
import { computeCompleteness } from './completeness'
import type { GapItem } from '@/types/gap-item'
import type { SessionSchema } from '@/types/session-schema'

const gap = (field: string, tier: 1 | 2 | 3, resolved = false): GapItem => ({
  field, label: field, phase: 4, tier, resolved,
})

describe('computeCompleteness', () => {
  it('treats a resolved gap as closed', () => {
    const schema: SessionSchema = {}
    const r = computeCompleteness(schema, [gap('business.foundingYear', 1, true)])
    expect(r.complete).toBe(true)
    expect(r.tier1Open).toHaveLength(0)
  })

  it('treats a gap whose field is filled in the schema as closed', () => {
    const schema: SessionSchema = { business: { foundingYear: '2005' } as SessionSchema['business'] }
    const r = computeCompleteness(schema, [gap('business.foundingYear', 1)])
    expect(r.tier1Open).toHaveLength(0)
  })

  it('reports an unresolved, unfilled Tier-1 gap as open', () => {
    const schema: SessionSchema = { business: { foundingYear: '' } as SessionSchema['business'] }
    const r = computeCompleteness(schema, [gap('business.foundingYear', 1)])
    expect(r.complete).toBe(false)
    expect(r.tier1Open.map((g) => g.field)).toContain('business.foundingYear')
  })

  it('buckets open gaps by tier', () => {
    const schema: SessionSchema = {}
    const r = computeCompleteness(schema, [gap('business.foundingYear', 1), gap('business.pricing', 2)])
    expect(r.tier1Open).toHaveLength(1)
    expect(r.tier2Open).toHaveLength(1)
  })
})
