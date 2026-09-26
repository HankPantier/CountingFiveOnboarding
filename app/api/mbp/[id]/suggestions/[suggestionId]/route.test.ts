import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory mbp_suggestions + sessions rows. Updates honor every .eq() filter
// (so a status-conditional claim only lands once), and each await yields so two
// concurrent PATCHes genuinely interleave.
const h = vi.hoisted(() => ({
  suggestion: null as null | Record<string, unknown>,
  schema: {} as Record<string, unknown>,
  applyCalls: [] as Array<{ updates: Record<string, unknown>; options: Record<string, unknown> }>,
  applyResult: { success: true } as { success: boolean; error?: string; stale?: string[] },
}))

vi.mock('@/lib/auth/access', () => ({
  requireOnboardingSessionAccess: vi.fn(async () => ({ user: { id: 'admin-1', isAdmin: true } })),
}))
vi.mock('@/lib/mbp/regenerate-if-approved', () => ({ regenerateMbpIfApproved: vi.fn() }))
vi.mock('next/server', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, after: () => undefined }
})
vi.mock('@/lib/mbp/apply-update', () => ({
  applyMbpUpdate: vi.fn(async (_s: unknown, _id: string, updates: Record<string, unknown>, _g: unknown, options: Record<string, unknown>) => {
    h.applyCalls.push({ updates, options })
    await new Promise(r => setTimeout(r, 5))
    return h.applyResult
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      let patch: Record<string, unknown> | null = null
      const tick = () => new Promise(r => setTimeout(r, 1))
      const matches = () =>
        !!h.suggestion && Object.entries(filters).every(([k, v]) => (h.suggestion as Record<string, unknown>)[k] === v)
      const b: Record<string, unknown> = {
        select: () => {
          if (patch) {
            const p = patch
            return tick().then(() => {
              if (!matches()) return { data: [], error: null }
              Object.assign(h.suggestion as Record<string, unknown>, p)
              return { data: [{ id: 'sg-1' }], error: null }
            })
          }
          return b
        },
        update: (p: Record<string, unknown>) => { patch = p; return b },
        eq: (k: string, v: unknown) => { filters[k] = v; return b },
        maybeSingle: async () => { await tick(); return { data: matches() ? { ...h.suggestion } : null } },
        single: async () => { await tick(); return { data: table === 'sessions' ? { schema_data: h.schema } : null } },
        then: (resolve: (v: unknown) => void) => {
          // Bare awaited update (releaseClaim).
          if (patch && matches()) Object.assign(h.suggestion as Record<string, unknown>, patch)
          resolve({ error: null })
        },
      }
      return b
    },
  }),
}))

import { PATCH } from './route'

const SESSION = '11111111-1111-1111-1111-111111111111'
const patchReq = (action: string) =>
  PATCH(new Request('http://test', { method: 'PATCH', body: JSON.stringify({ action }) }), {
    params: Promise.resolve({ id: SESSION, suggestionId: 'sg-1' }),
  })

beforeEach(() => {
  h.applyCalls = []
  h.applyResult = { success: true }
  h.schema = { team: [{ name: 'A' }] }
  h.suggestion = {
    id: 'sg-1',
    session_id: SESSION,
    status: 'pending',
    changes: { team: { op: 'append', proposedValue: { name: 'B' }, rationale: 'new hire' } },
  }
})

describe('PATCH /api/mbp/[id]/suggestions/[suggestionId]', () => {
  it('applies a double-clicked approve exactly once', async () => {
    const [a, b] = await Promise.all([patchReq('approve'), patchReq('approve')])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(h.applyCalls).toHaveLength(1)
    expect(h.suggestion?.status).toBe('approved')
  })

  it('refuses a stale whole-array set with 409 and returns the suggestion to pending', async () => {
    h.suggestion!.changes = {
      niches: { op: 'set', currentValue: [{ name: 'Dentists' }], proposedValue: [{ name: 'Dentists' }, { name: 'Vets' }], rationale: 'x' },
    }
    h.applyResult = { success: false, stale: ['niches'], error: 'Changed since suggested' }
    const res = await patchReq('approve')
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toMatch(/changed since it was suggested/)
    expect(h.applyCalls[0].options.expect).toEqual([{ path: 'niches', value: [{ name: 'Dentists' }] }])
    expect(h.suggestion?.status).toBe('pending')
  })

  it('never applies a _meta path', async () => {
    h.suggestion!.changes = {
      '_meta.mode': { op: 'set', proposedValue: 'staff', rationale: 'x' },
      'business.tagline': { op: 'set', proposedValue: 'Hi', rationale: 'x' },
    }
    const res = await patchReq('approve')
    expect(res.status).toBe(200)
    expect(h.applyCalls[0].updates).toEqual({ 'business.tagline': 'Hi' })
  })

  it('dismisses once and 409s the second dismiss', async () => {
    const [a, b] = await Promise.all([patchReq('dismiss'), patchReq('dismiss')])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(h.suggestion?.status).toBe('dismissed')
    expect(h.applyCalls).toHaveLength(0)
  })

  it('rejects a malformed body with 400', async () => {
    const res = await PATCH(new Request('http://test', { method: 'PATCH', body: '{bad' }), {
      params: Promise.resolve({ id: SESSION, suggestionId: 'sg-1' }),
    })
    expect(res.status).toBe(400)
  })
})
