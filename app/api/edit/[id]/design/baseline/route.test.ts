import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { SID } from '@/lib/design/__fixtures__/rows'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  ensure: vi.fn(),
}))

vi.mock('../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('../_baseline', () => ({ ensureDesignBaseline: (...a: unknown[]) => m.ensure(...a) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))

import { POST } from './route'

const call = () => POST(new Request('http://x/api', { method: 'POST' }), { params: Promise.resolve({ id: SID }) })

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.gate.mockReset().mockResolvedValue({ sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.ensure.mockReset().mockResolvedValue({ baseline: { status: 'ok', created: true } })
})

describe('POST /design/baseline', () => {
  it('returns 401 when unauthenticated', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await call()
    expect(res.status).toBe(401)
    expect(m.ensure).not.toHaveBeenCalled()
  })

  it('returns 403 for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await call()
    expect(res.status).toBe(403)
    expect(m.ensure).not.toHaveBeenCalled()
  })

  it('creates v0 when the session has no version', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ baseline: { status: 'ok', created: true } })
    expect(m.ensure.mock.calls[0][1]).toMatchObject({ sessionId: SID, githubRepo: 'o/r', adminId: 'admin-1' })
  })

  it('is a no-op when a version already exists', async () => {
    m.ensure.mockResolvedValue({ baseline: { status: 'ok', created: false } })
    const res = await call()
    expect(await res.json()).toEqual({ baseline: { status: 'ok', created: false } })
  })

  it('reports an import failure in the body, not as a 5xx', async () => {
    m.ensure.mockResolvedValue({ baseline: { status: 'error', error: 'Malformed override markers' } })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ baseline: { status: 'error', error: 'Malformed override markers' } })
  })

  it('hides internal error text on an unexpected failure', async () => {
    m.ensure.mockRejectedValue(new Error('GitHub 502 secret detail'))
    const res = await call()
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).not.toContain('secret')
  })
})
