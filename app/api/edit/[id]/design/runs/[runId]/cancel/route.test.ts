import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { RID, SID, makeRunRow } from '@/lib/design/__fixtures__/rows'

const m = vi.hoisted(() => ({ gate: vi.fn(), getRun: vi.fn(), transitionRun: vi.fn() }))
vi.mock('../../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/run-store', () => ({
  getRun: (...a: unknown[]) => m.getRun(...a),
  transitionRun: (...a: unknown[]) => m.transitionRun(...a),
}))

import { POST } from './route'

const call = (runId = RID) => POST(new Request('http://x/api', { method: 'POST' }), { params: Promise.resolve({ id: SID, runId }) })

beforeEach(() => {
  vi.clearAllMocks()
  m.gate.mockResolvedValue({ sessionId: SID, user: { isAdmin: true } })
  m.getRun.mockResolvedValue(makeRunRow({ status: 'generating' }))
  m.transitionRun.mockResolvedValue(makeRunRow({ status: 'cancelled' }))
})

describe('POST /design/runs/[runId]/cancel', () => {
  it('passes the gate response through', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await call()).status).toBe(403)
  })
  it('400s a bad run id', async () => {
    expect((await call('nope')).status).toBe(400)
  })
  it('404s a run from another session', async () => {
    m.getRun.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(m.getRun).toHaveBeenCalledWith({}, SID, RID)
  })
  it('cancels an active run with a guarded transition', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ['queued', 'capturing', 'generating', 'refining'], { status: 'cancelled', error: null })
  })
  it('409s a run that is no longer in progress', async () => {
    m.transitionRun.mockResolvedValue(null)
    expect((await call()).status).toBe(409)
  })
})
