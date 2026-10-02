import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const SID = '11111111-1111-4111-8111-111111111111'
const m = vi.hoisted(() => ({
  gate: vi.fn(),
  rows: vi.fn(),
  change: vi.fn(),
  baseline: vi.fn(async () => ({})),
}))
vi.mock('../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('../_baseline', () => ({ ensureDesignBaseline: () => m.baseline() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/lock-store', async (orig) => ({ ...((await orig()) as object), listLockRows: () => m.rows() }))
vi.mock('@/lib/design/lock-ops', () => ({ changeLocks: (...a: unknown[]) => m.change(...a) }))
vi.mock('@/lib/design/commit-version', () => ({ commitDesignVersion: vi.fn() }))
vi.mock('@/lib/design/theme-snapshot', async (orig) => {
  const { DRAFT_FILES } = await import('@/lib/design/__fixtures__/theme-texts')
  return { ...((await orig()) as object), readDraftThemeTexts: async () => ({ ok: true, files: { ...DRAFT_FILES, themeCss: '' }, shas: {} }) }
})

import { DELETE, GET, POST } from './route'

const params = { params: Promise.resolve({ id: SID }) }
const CTX = { sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', adminEmail: 'a@x.com', adminName: 'Ada', user: {} }
const ROW = { id: 'l1', session_id: SID, kind: 'area', key: 'service-cards', label: 'Service cards', snapshot: null, created_by: null, created_at: '2026-10-02T00:00:00Z' }

beforeEach(() => {
  vi.resetAllMocks()
  m.gate.mockResolvedValue(CTX)
  m.rows.mockResolvedValue([ROW])
  m.change.mockResolvedValue({ ok: true, locks: [], changed: ['Service cards'], versionNo: 4 })
})

describe('/api/edit/[id]/design/locks', () => {
  it('is gated by requireDesignAdmin first', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await GET(new Request('http://t'), params)).status).toBe(403)
    expect((await POST(new Request('http://t', { method: 'POST', body: '{}' }), params)).status).toBe(403)
    expect((await DELETE(new Request('http://t?key=palette', { method: 'DELETE' }), params)).status).toBe(403)
    expect(m.rows).not.toHaveBeenCalled()
  })

  it('GET lists the locks without their snapshots', async () => {
    const res = await GET(new Request('http://t'), params)
    expect(await res.json()).toEqual({ locks: [{ kind: 'area', key: 'service-cards', label: 'Service cards', createdAt: '2026-10-02T00:00:00Z' }] })
  })

  it('POST validates every key before touching anything', async () => {
    const bad = await POST(new Request('http://t', { method: 'POST', body: JSON.stringify({ areas: ['../etc'], levers: [] }) }), params)
    expect(bad.status).toBe(400)
    const notArray = await POST(new Request('http://t', { method: 'POST', body: JSON.stringify({ levers: 'palette' }) }), params)
    expect(notArray.status).toBe(400)
    expect(m.change).not.toHaveBeenCalled()
  })

  it('POST locks through changeLocks on the draft design and returns the fresh list', async () => {
    const res = await POST(new Request('http://t', { method: 'POST', body: JSON.stringify({ areas: ['service-cards'], label: 'What we do' }) }), params)
    expect(res.status).toBe(200)
    expect(m.change.mock.calls[0][1]).toMatchObject({ change: { op: 'lock', areas: ['service-cards'], levers: [], label: 'What we do' }, target: { sessionId: SID } })
    expect(await res.json()).toMatchObject({ changed: ['Service cards'], versionNo: 4, locks: [{ key: 'service-cards' }] })
  })

  it('DELETE infers the kind from the key and refuses an unknown one', async () => {
    expect((await DELETE(new Request('http://t?key=nope', { method: 'DELETE' }), params)).status).toBe(400)
    await DELETE(new Request('http://t?key=layout%3Acards', { method: 'DELETE' }), params)
    expect(m.change.mock.calls[0][1]).toMatchObject({ change: { op: 'unlock', keys: [{ kind: 'lever', key: 'layout:cards' }] } })
  })

  it('maps a refused commit to its status and hides raw errors behind internalError', async () => {
    m.change.mockResolvedValueOnce({ ok: false, status: 409, error: 'The theme changed while applying' })
    expect((await DELETE(new Request('http://t?key=palette', { method: 'DELETE' }), params)).status).toBe(409)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.change.mockRejectedValueOnce(new Error('postgres exploded: secret detail'))
    const res = await DELETE(new Request('http://t?key=palette', { method: 'DELETE' }), params)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
  })
})
