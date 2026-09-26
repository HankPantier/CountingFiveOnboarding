import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { SID } from '@/lib/design/__fixtures__/rows'
import { BRAND_TEXT, DESIGN_TEXT } from '@/lib/design/__fixtures__/theme-texts'

const m = vi.hoisted(() => ({ gate: vi.fn(), snapshot: vi.fn(), sync: vi.fn() }))
vi.mock('../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/theme-snapshot', async (orig) => ({ ...((await orig()) as object), readDraftThemeSnapshot: (r: string) => m.snapshot(r) }))
vi.mock('@/lib/design/sync-mbp-theme', async (orig) => ({ ...((await orig()) as object), syncMbpTheme: (...a: unknown[]) => m.sync(...a) }))

import { POST } from './route'

const call = () => POST(new Request('http://x/api', { method: 'POST' }), { params: Promise.resolve({ id: SID }) })
const SHAS = { 'content/brand.json': 'a'.repeat(40), 'content/design.json': 'b'.repeat(40) }

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.gate.mockResolvedValue({ sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.snapshot.mockResolvedValue({ shas: SHAS, texts: { 'content/brand.json': BRAND_TEXT, 'content/design.json': DESIGN_TEXT } })
  m.sync.mockResolvedValue(true)
})

describe('POST /design/sync-mbp', () => {
  it('passes the gate response through', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(m.sync).not.toHaveBeenCalled()
  })

  it('mirrors the draft’s FULL palette + fonts regardless of what changed', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const args = m.sync.mock.calls[0][1] as { sessionId: string; jobId: string; brand: { palette: unknown }; design: { typography: unknown } }
    expect(args).toMatchObject({ sessionId: SID, jobId: 'job-1' })
    expect(args.brand.palette).toEqual(JSON.parse(BRAND_TEXT).palette)
    expect(args.design.typography).toBeTruthy()
  })

  it('409s when the draft has no theme files, 503s when the sync did not land', async () => {
    m.snapshot.mockResolvedValueOnce({ shas: {}, texts: {} })
    expect((await call()).status).toBe(409)
    m.sync.mockResolvedValueOnce(false)
    expect((await call()).status).toBe(503)
  })

  it('never leaks raw errors on an unexpected failure', async () => {
    m.snapshot.mockRejectedValueOnce(new Error('GitHub secret detail'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
  })
})
