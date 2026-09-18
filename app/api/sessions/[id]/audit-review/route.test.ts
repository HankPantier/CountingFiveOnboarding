import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSchema } from '@/types/session-schema'

const h = vi.hoisted(() => ({
  schema: {} as SessionSchema,
  gaps: [] as unknown[],
  updates: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/auth/access', () => ({
  requireSessionAccess: vi.fn(async () => ({ user: { id: 'u-1' } })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      let kind: 'select' | 'update' = 'select'
      const builder: Record<string, unknown> = {
        select() { kind = 'select'; return builder },
        update(payload: Record<string, unknown>) { kind = 'update'; h.updates.push(payload); return builder },
        eq() { return builder },
        single: async () => ({ data: { schema_data: h.schema, gap_list: h.gaps }, error: null }),
        then(resolve: (v: unknown) => void) {
          if (kind === 'update') resolve({ error: null })
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
})
