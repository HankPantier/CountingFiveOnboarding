import { describe, expect, it } from 'vitest'
import {
  partitionServices,
  partitionNiches,
  partitionSubCategories,
  resolveBlockParent,
  blocksForPage,
} from './page-treatment'
import type { SessionSchema } from '@/types/session-schema'

type PT = 'page' | 'block' | 'exclude'
const svc = (name: string, pageTreatment?: PT, parent?: string) => ({
  name, description: '', offerings: [], ...(pageTreatment ? { pageTreatment } : {}), ...(parent ? { parent } : {}),
})
const sub = (name: string, pageTreatment?: PT) => ({ name, status: 'confirmed' as const, ...(pageTreatment ? { pageTreatment } : {}) })
const nch = (name: string, subCategories?: ReturnType<typeof sub>[], pageTreatment?: PT) => ({
  name, description: '', icp: '', painPoints: '', valueProp: '',
  ...(pageTreatment ? { pageTreatment } : {}), ...(subCategories ? { subCategories } : {}),
})

describe('page-treatment partitions', () => {
  it('splits services into page (default/page) vs block', () => {
    const schema = { services: [svc('A'), svc('B', 'block'), svc('C', 'page')] } as SessionSchema
    const { pageServices, blockServices } = partitionServices(schema)
    expect(pageServices.map((s) => s.name)).toEqual(['A', 'C'])
    expect(blockServices.map((s) => s.name)).toEqual(['B'])
  })

  it('splits niches into page (default/page) vs block', () => {
    const schema = { niches: [nch('X'), nch('Y', undefined, 'block')] } as SessionSchema
    const { pageNiches, blockNiches } = partitionNiches(schema)
    expect(pageNiches.map((n) => n.name)).toEqual(['X'])
    expect(blockNiches.map((n) => n.name)).toEqual(['Y'])
  })

  it('splits sub-services into page (promoted) vs block (default)', () => {
    const niche = nch('X', [sub('S1'), sub('S2', 'page'), sub('S3', 'block')])
    const { pageSubs, blockSubs } = partitionSubCategories(niche)
    expect(pageSubs.map((s) => s.name)).toEqual(['S2'])
    expect(blockSubs.map((s) => s.name)).toEqual(['S1', 'S3'])
  })
})

describe('resolveBlockParent', () => {
  it('uses an operator-picked parent when set', () => {
    expect(resolveBlockParent({ parent: '/services/tax' }, 'service')).toBe('/services/tax')
  })
  it('falls back to the category hub / niche page', () => {
    expect(resolveBlockParent({}, 'service')).toBe('/services')
    expect(resolveBlockParent({}, 'niche')).toBe('/industries')
    expect(resolveBlockParent({}, 'sub', { nicheSlug: 'dental' })).toBe('/industries/dental')
  })
})

describe('blocksForPage', () => {
  const schema = {
    services: [svc('Audit Protection', 'block'), svc('Tax', 'page')],
    niches: [nch('Dental', [sub('Bookkeeping'), sub('Payroll', 'page')])],
  } as SessionSchema

  it('attaches a block service to its default hub', () => {
    const b = blocksForPage(schema, '/services')
    expect(b.services).toEqual(['Audit Protection'])
    expect(b.niches).toEqual([])
    expect(b.subs).toEqual([])
  })

  it('attaches a block sub-service to its owning niche page (promoted sub excluded)', () => {
    const b = blocksForPage(schema, '/industries/dental')
    expect(b.subs).toEqual([{ niche: 'Dental', name: 'Bookkeeping' }])
  })

  it('returns nothing for an unrelated page', () => {
    const b = blocksForPage(schema, '/about')
    expect(b).toEqual({ services: [], niches: [], subs: [] })
  })
})
