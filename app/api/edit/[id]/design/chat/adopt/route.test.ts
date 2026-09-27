import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { SID } from '@/lib/design/__fixtures__/rows'

const m = vi.hoisted(() => ({ gate: vi.fn(), setAdopted: vi.fn() }))
vi.mock('../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/chat-store', () => ({ setAdoptedConceptId: (...a: unknown[]) => m.setAdopted(...a) }))

import { DELETE } from './route'

const params = { params: Promise.resolve({ id: SID }) }
const del = () => DELETE(new Request('http://x', { method: 'DELETE' }), params)

beforeEach(() => {
  vi.resetAllMocks()
  m.gate.mockResolvedValue({ sessionId: SID })
  m.setAdopted.mockResolvedValue(true)
})

describe('DELETE design/chat/adopt', () => {
  it('passes the admin gate response through and touches nothing', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await del()).status).toBe(403)
    expect(m.setAdopted).not.toHaveBeenCalled()
  })
  it('clears the concept of the GATED session', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(m.setAdopted).toHaveBeenCalledWith({}, SID, null)
  })
  it('a failed write is a 503, not a silent success', async () => {
    m.setAdopted.mockResolvedValue(false)
    expect((await del()).status).toBe(503)
  })
})
