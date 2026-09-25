import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { IID, SID, makeInputRow, makeRunRow } from '@/lib/design/__fixtures__/rows'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  listInputs: vi.fn(),
  snapshot: vi.fn(),
  caps: vi.fn(),
  createRun: vi.fn(),
  chainOrFail: vi.fn(async (..._a: unknown[]) => {}),
  failActiveRun: vi.fn(async (..._a: unknown[]) => {}),
  loadRun: vi.fn(),
  after: vi.fn(),
}))

vi.mock('../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/store', () => ({ listInputs: (...a: unknown[]) => m.listInputs(...a) }))
vi.mock('@/lib/design/theme-snapshot', () => ({ readDraftThemeSnapshot: (r: string) => m.snapshot(r) }))
vi.mock('@/lib/design/capabilities-read', () => ({ readDesignCapabilities: (r: string) => m.caps(r) }))
vi.mock('@/lib/design/run-store', async (orig) => ({ ...((await orig()) as object), createRun: (...a: unknown[]) => m.createRun(...a) }))
vi.mock('@/lib/design/run-trigger', () => ({
  chainOrFail: (...a: unknown[]) => m.chainOrFail(...a),
  failActiveRun: (...a: unknown[]) => m.failActiveRun(...a),
  STEP_CHAIN_ERROR: 'Couldn’t start the next background step — press Retry.',
}))
vi.mock('@/lib/design/run-view', () => ({ loadLatestRunDto: (...a: unknown[]) => m.loadRun(...a) }))
vi.mock('next/server', async (orig) => ({ ...((await orig()) as object), after: (fn: () => unknown) => m.after(fn) }))

import { ActiveRunExistsError } from '@/lib/design/run-store'
import { DEFAULT_CAPABILITIES } from '@/lib/design/run-types'
import { GET, POST } from './route'

const params = { params: Promise.resolve({ id: SID }) }
const post = (body: unknown) =>
  POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), params)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.gate.mockResolvedValue({ sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.listInputs.mockResolvedValue([makeInputRow({ capture_status: 'ok', storage_path: `design/${SID}/inputs/a.webp` })])
  m.snapshot.mockResolvedValue({ shas: { 'content/brand.json': 'a'.repeat(40) }, texts: {} })
  m.caps.mockResolvedValue(DEFAULT_CAPABILITIES)
  m.createRun.mockResolvedValue(makeRunRow())
  m.loadRun.mockResolvedValue(null)
})

describe('POST /design/runs', () => {
  it('passes the gate response through for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await post({})).status).toBe(403)
    expect(m.createRun).not.toHaveBeenCalled()
  })

  it('400s an invalid body', async () => {
    const res = await post({ conceptCount: 9 })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'conceptCount must be 2 or 3.' })
  })

  it('400s an input id that is not in this session', async () => {
    const res = await post({ inputIds: ['11111111-2222-4333-8444-555555555555'] })
    expect(res.status).toBe(400)
  })

  it('creates a queued run with the capability + theme snapshot and kicks off the first step', async () => {
    const res = await post({ paletteFreedom: 'keep', inputIds: [IID], adminBrief: 'Warmer', pagePath: '/about' })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ runId: makeRunRow().id })
    expect(m.createRun.mock.calls[0][1]).toEqual({
      sessionId: SID,
      createdBy: 'admin-1',
      paletteFreedom: 'keep',
      adminBrief: 'Warmer',
      conceptCount: 3,
      inputIds: [IID],
      capabilities: DEFAULT_CAPABILITIES,
      baseSnapshot: { pagePath: '/about', themeShas: { 'content/brand.json': 'a'.repeat(40) }, screenshots: [], notes: [] },
    })
    expect(m.after).toHaveBeenCalledTimes(1)
    await (m.after.mock.calls[0][0] as () => Promise<void>)()
    expect(m.chainOrFail).toHaveBeenCalledWith({}, SID, makeRunRow().id)
  })

  it('409s when a run is already active', async () => {
    m.createRun.mockRejectedValue(new ActiveRunExistsError(SID))
    const res = await post({})
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'A design run is already in progress for this client.' })
  })

  it('hides raw errors behind a generic 500', async () => {
    m.snapshot.mockRejectedValue(new Error('GitHub 502 secret detail'))
    const res = await post({})
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to start the design run' })
  })

  it('catches a thrown chain-kickoff error instead of leaving the run queued silently', async () => {
    m.chainOrFail.mockRejectedValue(new Error('unexpected'))
    await post({})
    await expect((m.after.mock.calls[0][0] as () => Promise<void>)()).resolves.toBeUndefined()
    expect(m.failActiveRun).toHaveBeenCalledWith({}, makeRunRow().id, 'Couldn’t start the next background step — press Retry.')
  })
})

describe('GET /design/runs', () => {
  it('returns the latest run', async () => {
    m.loadRun.mockResolvedValue({ id: 'r' })
    const res = await GET(new Request('http://x/api'), params)
    expect(await res.json()).toEqual({ run: { id: 'r' } })
  })
})
