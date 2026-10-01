import { describe, expect, it } from 'vitest'
import { applyDirectives, offeringTreatments } from './directive-review'
import { applyDirectivesToSitemap } from '@/lib/content/directive-sitemap'
import type { OperatorDirective, SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'

const SID = '11111111-2222-4333-8444-555555555555'
const SNAP = { path: `snapshots/${SID}/0f0f0f0f-1111-4222-8333-444444444444.md`, capturedAt: '', words: 40, links: 12 }
let n = 0
const d = (patch: Partial<OperatorDirective>): OperatorDirective => ({
  id: `aaaaaaaa-bbbb-4ccc-8ddd-${String(++n).padStart(12, '0')}`,
  kind: 'other',
  sourceText: 'instruction',
  status: 'resolved',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...patch,
})

const member = (name: string, bio = '') => ({ name, title: '', certifications: [], bio, specializations: [] })

const schema = (): SessionSchema => ({
  team: [member('John Smith', 'AI-written bio'), member('Jane Doe')],
  current_sitemap: [
    { url: '/forms-documents-links', title: 'Forms, Documents & Links', action: 'keep', live: true },
    { url: '/about', title: 'About', action: 'keep', live: true },
    { url: '/our-history', title: 'Our History', action: 'keep', live: true },
    { url: '/promo-2019', title: 'Promo', action: 'keep', live: true },
  ],
  proposed_sitemap: [
    { url: '/about', title: 'About us', status: 'update', parent: '/' },
    { url: '/our-history', title: 'Our History', status: 'update', parent: '/about' },
    { url: '/promo-2019', title: 'Promo', status: 'update', parent: '/' },
  ],
})

describe('applyDirectivesToSitemap', () => {
  const directives = () => [
    d({ kind: 'bring_page', sourceUrl: '/forms-documents-links', verbatim: true, keepLinks: true, snapshot: SNAP }),
    d({ kind: 'merge_page', sourceUrl: '/our-history', targetUrl: '/about' }),
    d({ kind: 'drop_page', sourceUrl: '/promo-2019' }),
  ]

  it('brings, merges and drops pages', () => {
    const ds = directives()
    const out = applyDirectivesToSitemap({ ...schema(), operator_directives: ds })
    const proposed = out.proposed_sitemap ?? []
    expect(proposed.map((p) => p.url).sort()).toEqual(['/about', '/forms-documents-links'])
    const forms = proposed.find((p) => p.url === '/forms-documents-links')
    expect(forms).toMatchObject({ mode: 'verbatim', directiveId: ds[0].id, title: 'Forms, Documents & Links' })
    expect(proposed.find((p) => p.url === '/about')?.mergeFrom).toEqual(['/our-history'])
    const cur = Object.fromEntries((out.current_sitemap ?? []).map((r) => [r.url, r]))
    expect(cur['/our-history']).toMatchObject({ action: 'consolidate', new_url: '/about' })
    expect(cur['/promo-2019']).toMatchObject({ action: 'redirect', new_url: '/' })
  })

  it('is idempotent', () => {
    const ds = directives()
    const once = applyDirectivesToSitemap({ ...schema(), operator_directives: ds })
    const twice = applyDirectivesToSitemap(once)
    expect(twice).toEqual(once)
  })

  it('reverts a directive that was removed', () => {
    const ds = directives()
    const applied = applyDirectivesToSitemap({ ...schema(), operator_directives: ds })
    const reverted = applyDirectivesToSitemap({ ...applied, operator_directives: [] })
    const cur = Object.fromEntries((reverted.current_sitemap ?? []).map((r) => [r.url, r]))
    expect(cur['/our-history']).toEqual({ url: '/our-history', title: 'Our History', action: 'keep', live: true })
    expect(cur['/promo-2019'].action).toBe('keep')
    const urls = (reverted.proposed_sitemap ?? []).map((p) => p.url)
    expect(urls).toEqual(expect.arrayContaining(['/our-history', '/promo-2019']))
    expect((reverted.proposed_sitemap ?? []).some((p) => p.mode || p.directiveId || p.mergeFrom)).toBe(false)
  })

  it('ignores unresolved directives', () => {
    const out = applyDirectivesToSitemap({ ...schema(), operator_directives: [d({ kind: 'drop_page', sourceUrl: '/about', status: 'unresolved' })] })
    expect((out.proposed_sitemap ?? []).some((p) => p.url === '/about')).toBe(true)
  })
})

describe('applyDirectives', () => {
  it('writes a verbatim bio and flags it, clearing stale flags', () => {
    const base = schema()
    base.team![1] = { ...member('Jane Doe', 'Old exact bio'), bioVerbatim: true }
    const ds = [d({ kind: 'verbatim_content', teamMember: 'john smith', verbatimText: 'John has served clients since 1998.', snapshot: SNAP })]
    const { schema: out } = applyDirectives(base, [], ds)
    expect(out.team![0]).toMatchObject({ bio: 'John has served clients since 1998.', bioVerbatim: true })
    expect(out.team![1].bioVerbatim).toBeUndefined()
    expect(out.team![1].bio).toBe('Old exact bio')
    expect(out.operator_directives).toEqual(ds)
  })

  it('turns unresolved directives into Q&A gaps, recomputed on resubmit', () => {
    const prior: GapItem[] = [
      { field: 'business.foundingYear', label: 'Founded', phase: 4, tier: 1, resolved: false },
      { field: 'operator_directives[5].clarification', label: 'stale', phase: 4, tier: 2, resolved: false },
    ]
    const ds = [d({}), d({ kind: 'bring_page', status: 'unresolved', sourceText: 'Bring over the client portal page' })]
    const { gaps } = applyDirectives(schema(), prior, ds)
    expect(gaps.map((g) => g.field)).toEqual(['business.foundingYear', 'operator_directives[1].clarification'])
    expect(gaps[1]).toMatchObject({ tier: 2, resolved: false })
  })

  it('does not mutate its input', () => {
    const base = schema()
    const before = structuredClone(base)
    applyDirectives(base, [], [d({ kind: 'drop_page', sourceUrl: '/promo-2019' })])
    expect(base).toEqual(before)
  })
})

describe('offeringTreatments', () => {
  it('maps resolved add_offering cards to review treatments', () => {
    const out = offeringTreatments([
      d({ kind: 'add_offering', offering: { type: 'service', name: 'CFO Advisory', treatment: 'page' } }),
      d({ kind: 'add_offering', offering: { type: 'niche', name: 'Dentists', treatment: 'block', parent: '/industries' } }),
      d({ kind: 'add_offering', status: 'unresolved', offering: { type: 'service', name: 'Skip', treatment: 'page' } }),
    ])
    expect(out.services).toEqual([{ name: 'CFO Advisory', pageTreatment: 'page', origin: 'audit' }])
    expect(out.niches).toEqual([{ name: 'Dentists', pageTreatment: 'block', origin: 'audit', parent: '/industries' }])
  })
})
