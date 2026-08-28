import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  job: { session_id: 'sess-1', library_reviewed_at: '2026-08-27T00:00:00Z' } as {
    session_id: string
    library_reviewed_at: string | null
  },
  firmName: 'Acme CPA' as string | null,
  after: vi.fn(),
  runContentGeneration: vi.fn(),
}))

vi.mock('@/lib/auth/access', () => ({
  requireContentJobAccess: vi.fn(async () => ({ user: { id: 'u' }, sessionId: 'sess-1' })),
}))
vi.mock('@/lib/content/content-generator', () => ({
  runContentGeneration: (...a: unknown[]) => h.runContentGeneration(...a),
}))
vi.mock('next/server', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, after: (fn: () => void) => h.after(fn) }
})
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            table === 'sessions'
              ? { data: { schema_data: { business: { name: h.firmName } } } }
              : { data: h.job },
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({ single: async () => ({ data: { session_id: h.job.session_id }, error: null }) }),
        }),
      }),
    }),
  }),
}))

import { PATCH } from './route'

const params = Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' })
const patchPhase5 = () =>
  PATCH(new Request('http://test', { method: 'PATCH', body: JSON.stringify({ phase: 5 }) }), { params })

beforeEach(() => {
  h.job = { session_id: 'sess-1', library_reviewed_at: '2026-08-27T00:00:00Z' }
  h.firmName = 'Acme CPA'
  h.after.mockReset()
  h.runContentGeneration.mockReset()
})

describe('PATCH /api/content-jobs/[id] — phase 5 gates', () => {
  it('blocks the phase 4→5 advance (422) when the library choice was never confirmed', async () => {
    h.job.library_reviewed_at = null
    const res = await patchPhase5()
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/library-content choice/i)
    expect(h.after).not.toHaveBeenCalled()
  })

  it('still blocks (422) when the MBP has no firm name, even after library review', async () => {
    h.firmName = '   '
    const res = await patchPhase5()
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/firm name/i)
  })

  it('advances and triggers generation when library is reviewed and the firm is named', async () => {
    const res = await patchPhase5()
    expect(res.status).toBe(200)
    expect(h.after).toHaveBeenCalledOnce()
  })
})
