import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSchema } from '@/types/session-schema'

const h = vi.hoisted(() => ({
  schema: {} as SessionSchema,
  gaps: [] as unknown[],
  updates: [] as Array<Record<string, unknown>>,
  afterCalls: 0,
  snapshot: '' as string | null,
}))

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: vi.fn(() => { h.afterCalls++ }),
}))

vi.mock('@/lib/onboarding/page-snapshot', () => ({
  readSnapshot: vi.fn(async () => h.snapshot),
}))

vi.mock('@/lib/session-draft/apply-notes-extraction', () => ({
  applyNotesExtraction: vi.fn(async () => []),
}))

vi.mock('@/lib/auth/access', () => ({
  requireOnboardingSessionAccess: vi.fn(async () => ({ user: { id: 'u-1' } })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      let kind: 'select' | 'update' = 'select'
      const builder: Record<string, unknown> = {
        // A select after update is the CAS write's `.select('id')` — keep kind.
        select() { if (kind !== 'update') kind = 'select'; return builder },
        update(payload: Record<string, unknown>) { kind = 'update'; h.updates.push(payload); return builder },
        eq() { return builder },
        single: async () => ({ data: { schema_data: h.schema, gap_list: h.gaps }, error: null }),
        maybeSingle: async () => ({
          data: { id: 's-1', schema_data: h.schema, gap_list: h.gaps, schema_version: 0 },
          error: null,
        }),
        then(resolve: (v: unknown) => void) {
          if (kind === 'update') resolve({ data: [{ id: 's-1' }], error: null })
          else resolve({ data: { schema_data: h.schema, gap_list: h.gaps }, error: null })
        },
      }
      return builder
    },
  }),
}))

import { POST } from './route'

const ID = '11111111-1111-1111-1111-111111111111'
const params = Promise.resolve({ id: ID })
const post = (body: unknown) =>
  POST(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }), { params })

beforeEach(() => {
  h.schema = {
    services: [{ name: 'Bookkeeping', description: '', offerings: [], origin: 'site' }],
    niches: [{ name: 'Dental', description: '', icp: '', painPoints: '', valueProp: '', origin: 'site' }],
    team: [{ name: 'Ann', title: '', certifications: [], bio: '', specializations: [] }],
    business: { name: 'Acme' } as SessionSchema['business'],
  } as SessionSchema
  h.gaps = []
  h.updates = []
  h.afterCalls = 0
  h.snapshot = null
})

describe('POST /api/sessions/[id]/audit-review', () => {
  it('applies every review in one atomic write and sets the markers + notes_extracted_at', async () => {
    const res = await post({
      callNotes: 'Call went well',
      services: [{ name: 'Bookkeeping', pageTreatment: 'block', parent: '/services', origin: 'site' }],
      niches: [{ name: 'Dental', pageTreatment: 'page', origin: 'site' }],
      subcategories: [],
      geo: { scope: 'local', areas: [{ city: 'Nashua', state: 'NH', primary: true }] },
      team: { keep: [], remove: ['Ann'], add: [{ name: 'Bob', title: 'CPA' }] },
    })
    expect(res.status).toBe(200)

    // exactly one write
    expect(h.updates).toHaveLength(1)
    const payload = h.updates[0]
    expect(payload.call_notes).toBe('Call went well')
    expect(payload.notes_extracted_at).toBeTruthy()

    const written = payload.schema_data as SessionSchema
    // service → block with parent; niche → page; team → Ann removed, Bob added
    expect(written.services?.find(s => s.name === 'Bookkeeping')).toMatchObject({ status: 'kept', pageTreatment: 'block', parent: '/services' })
    expect(written.niches?.find(n => n.name === 'Dental')).toMatchObject({ status: 'kept', pageTreatment: 'page' })
    expect(written.team?.find(t => t.name === 'Ann')?.teamDecision).toBe('remove')
    expect(written.team?.some(t => t.name === 'Bob')).toBe(true)

    // all five review markers + the umbrella marker present
    expect(written._meta?.niche_review).toBeTruthy()
    expect(written._meta?.services_review).toBeTruthy()
    expect(written._meta?.subcategories_review).toBeTruthy()
    expect(written._meta?.geo_review).toMatchObject({ scope: 'local', areaCount: 1 })
    expect(written._meta?.team_review).toBeTruthy()
    expect(written._meta?.audit_review?.reviewedBy).toBe('u-1')

    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('tiers gaps by treatment — a block niche loses its deep page-only gaps', async () => {
    h.gaps = [
      { field: 'niches[0].painPoints', label: '', phase: 4, tier: 1, resolved: false },
      { field: 'niches[0].valueProp', label: '', phase: 4, tier: 1, resolved: false },
    ]
    await post({
      niches: [{ name: 'Dental', pageTreatment: 'block', parent: '/industries', origin: 'site' }],
      services: [],
      geo: { scope: 'national' },
      team: { keep: ['Ann'], remove: [], add: [] },
    })
    const written = h.updates[0].gap_list as { field: string }[]
    expect(written.some((g) => g.field === 'niches[0].painPoints')).toBe(false) // deep gap tiered out
    expect(written.some((g) => g.field === 'niches[0].valueProp')).toBe(true) // essence kept
  })

  it('rejects a non-UUID session id', async () => {
    const res = await POST(new Request('http://test', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    })
    expect(res.status).toBe(400)
  })

  describe('operator directives', () => {
    const SNAP = { path: `snapshots/${ID}/0f0f0f0f-1111-4222-8333-444444444444.md`, capturedAt: '', words: 10, links: 2 }
    const dirId = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, '0')}`
    const base = { services: [], niches: [], subcategories: [] }

    beforeEach(() => {
      h.schema = {
        ...h.schema,
        team: [{ name: 'John Smith', title: '', certifications: [], bio: 'AI bio', specializations: [] }],
        current_sitemap: [
          { url: '/forms', title: 'Forms', action: 'keep', live: true },
          { url: '/team', title: 'Team', action: 'keep', live: true },
        ],
        proposed_sitemap: [{ url: '/team', title: 'Team', status: 'update' }],
      } as SessionSchema
    })

    it('applies directives, re-resolving status server-side and adding new offerings', async () => {
      h.snapshot = 'Intro.\n\nJohn Smith has served clients since 1998.'
      const res = await post({
        ...base,
        directives: [
          { id: dirId(1), kind: 'bring_page', sourceText: 'Bring Forms over', sourceUrl: '/forms', status: 'unresolved' },
          { id: dirId(2), kind: 'verbatim_content', sourceText: 'Keep John’s bio', teamMember: 'John Smith', sourceUrl: '/team', verbatimText: 'John Smith has served clients since 1998.', snapshot: SNAP },
          { id: dirId(3), kind: 'add_offering', sourceText: 'Add CFO Advisory', offering: { type: 'service', name: 'CFO Advisory', treatment: 'page' } },
          { id: dirId(4), kind: 'drop_page', sourceText: 'Drop the careers page', sourceUrl: '/careers', status: 'resolved' },
        ],
      })
      expect(res.status).toBe(200)
      const schema = h.updates[0].schema_data as SessionSchema
      expect(schema.operator_directives?.map((d) => d.status)).toEqual(['resolved', 'resolved', 'resolved', 'unresolved'])
      expect(schema.team?.find((m) => m.name === 'John Smith')).toMatchObject({ bio: 'John Smith has served clients since 1998.', bioVerbatim: true })
      expect(schema.services?.find((s) => s.name === 'CFO Advisory')).toMatchObject({ status: 'kept', origin: 'audit', pageTreatment: 'page' })
      expect(schema.proposed_sitemap?.map((p) => p.url)).toContain('/forms')
      expect((h.updates[0].gap_list as Array<{ field: string }>).map((g) => g.field)).toContain('operator_directives[3].clarification')
    })

    it('resolves a verbatim bio for a team member added in the same submit', async () => {
      h.snapshot = 'Jane Doe joined in 2020 and leads payroll.'
      await post({
        ...base,
        team: { keep: ['John Smith'], remove: [], add: [{ name: 'Jane Doe', title: 'Payroll Lead' }] },
        directives: [
          { id: dirId(6), kind: 'verbatim_content', sourceText: 'Keep Jane’s bio', teamMember: 'Jane Doe', sourceUrl: '/team', verbatimText: 'Jane Doe joined in 2020 and leads payroll.', snapshot: SNAP },
        ],
      })
      const schema = h.updates[0].schema_data as SessionSchema
      expect(schema.operator_directives?.[0].status).toBe('resolved')
      expect(schema.team?.find((m) => m.name === 'Jane Doe')).toMatchObject({ bio: 'Jane Doe joined in 2020 and leads payroll.', bioVerbatim: true })
    })

    it('rejects a "verbatim" passage that is not in the stored snapshot', async () => {
      h.snapshot = 'Completely different page text.'
      await post({
        ...base,
        directives: [
          { id: dirId(5), kind: 'verbatim_content', sourceText: 'Keep John’s bio', teamMember: 'John Smith', sourceUrl: '/team', verbatimText: 'An altered bio.', snapshot: SNAP },
        ],
      })
      const schema = h.updates[0].schema_data as SessionSchema
      expect(schema.operator_directives?.[0]).toMatchObject({ status: 'unresolved' })
      expect(schema.operator_directives?.[0].verbatimText).toBeUndefined()
      expect(schema.team?.[0].bio).toBe('AI bio')
    })

    it('schedules notes extraction only when the notes changed', async () => {
      await post({ ...base, callNotes: 'Founded in 1998.' })
      expect(h.afterCalls).toBe(1)
    })
  })
})
