import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  updates: 0,
}))

vi.mock('@/lib/auth/access', () => ({
  requireContentJobAccess: vi.fn(async () => ({ user: { id: 'u' }, sessionId: 'sess-1' })),
}))
vi.mock('@/lib/mbp/impact-review', () => ({ reviewContentForMbpImpact: vi.fn() }))
vi.mock('@/lib/content/research-pipeline', () => ({ runResearchPipeline: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: h.job }) }) }),
      update: () => {
        h.updates++
        // The confirm's fenced write matches zero rows → the route's 409
        // "confirmed concurrently" path: proof it got PAST the brand gate.
        return { eq: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) }
      },
    }),
  }),
}))

import { POST } from './route'
import { DESIGN_SYSTEM_REQUIRED_FOR_SITEMAP } from '@/lib/content/brand-gate'

const PALETTE = Object.fromEntries(
  ['primary', 'secondary', 'complementary', 'action', 'nearBlack', 'nearWhite'].map((r) => [r, { hex: '#123456', name: r }]),
)
const TOKENS = { typePairing: { id: 'x', headingFont: 'Inter', bodyFont: 'Inter', label: 'Inter' } }
const params = Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' })
const confirm = () =>
  POST(
    new Request('http://test', { method: 'POST', body: JSON.stringify({ pages: [{ url: '/', title: 'Home' }] }) }),
    { params },
  )

beforeEach(() => {
  h.updates = 0
})

describe('POST /api/content-jobs/[id]/sitemap — Design System gate', () => {
  it('refuses (409) to confirm a sitemap before the Design System is locked', async () => {
    h.job = { phase: 1, updated_at: 't', palette: null, design_tokens: null }
    const res = await confirm()
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe(DESIGN_SYSTEM_REQUIRED_FOR_SITEMAP)
    expect(h.updates).toBe(0)
  })

  it('passes the gate once palette + tokens are locked', async () => {
    h.job = { phase: 2, updated_at: 't', palette: PALETTE, design_tokens: TOKENS }
    const res = await confirm()
    expect(((await res.json()) as { error: string }).error).toMatch(/confirmed concurrently/)
    expect(h.updates).toBe(1)
  })
})
