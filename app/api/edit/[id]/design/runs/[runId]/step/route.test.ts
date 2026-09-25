import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'
import { fakeSupabase } from '@/lib/design/__fixtures__/fake-supabase'
import { RID, SID, makeConceptRow, makeRunRow } from '@/lib/design/__fixtures__/rows'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  db: null as unknown,
  getRun: vi.fn(),
  listConcepts: vi.fn(),
  transitionRun: vi.fn(),
  resetConcepts: vi.fn(async (..._a: unknown[]) => {}),
  runDesignStep: vi.fn(),
  shouldChain: vi.fn(),
  chainOrFail: vi.fn(async (..._a: unknown[]) => {}),
  failActiveRun: vi.fn(async (..._a: unknown[]) => {}),
  after: vi.fn(),
}))

vi.mock('../../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => m.db }))
vi.mock('@/lib/design/run-store', async (orig) => ({
  ...((await orig()) as object),
  getRun: (...a: unknown[]) => m.getRun(...a),
  listConcepts: (...a: unknown[]) => m.listConcepts(...a),
  transitionRun: (...a: unknown[]) => m.transitionRun(...a),
  resetConcepts: (...a: unknown[]) => m.resetConcepts(...a),
}))
vi.mock('@/lib/design/run-orchestrator', () => ({
  runDesignStep: (...a: unknown[]) => m.runDesignStep(...a),
  shouldChain: (o: unknown) => m.shouldChain(o),
}))
vi.mock('@/lib/design/run-trigger', () => ({
  chainOrFail: (...a: unknown[]) => m.chainOrFail(...a),
  failActiveRun: (...a: unknown[]) => m.failActiveRun(...a),
}))
vi.mock('next/server', async (orig) => ({ ...((await orig()) as object), after: (fn: () => unknown) => m.after(fn) }))

import { ActiveRunExistsError } from '@/lib/design/run-store'
import { POST } from './route'

const call = (headers: Record<string, string> = {}, runId = RID) =>
  POST(new Request('http://x/api', { method: 'POST', headers }), { params: Promise.resolve({ id: SID, runId }) })
const runAfter = async () => {
  await (m.after.mock.calls[0][0] as () => Promise<void>)()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 's3cret')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.db = fakeSupabase({ content_jobs: [{ data: { id: 'job-1', session_id: SID, phase: 6, github_repo: 'o/r' } }] }).client
  m.gate.mockResolvedValue({ sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.getRun.mockResolvedValue(makeRunRow({ status: 'generating' }))
  m.listConcepts.mockResolvedValue([])
  m.runDesignStep.mockResolvedValue({ kind: 'generated', concepts: 3 })
  m.shouldChain.mockReturnValue(true)
})
afterEach(() => vi.unstubAllEnvs())

describe('POST step — gate matrix', () => {
  it('member / editor / owner: the admin gate’s 403 passes through', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(m.after).not.toHaveBeenCalled()
  })
  it('bad bearer → 401', async () => {
    expect((await call({ authorization: 'Bearer nope' })).status).toBe(401)
    expect(m.gate).not.toHaveBeenCalled()
  })
  it('empty CRON_SECRET fails closed → 500, even for "Bearer undefined"', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const res = await call({ authorization: 'Bearer undefined' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Server misconfigured' })
  })
  it('valid bearer → 202 and runs one step for the session’s content job, then chains', async () => {
    const res = await call({ authorization: 'Bearer s3cret' })
    expect(res.status).toBe(202)
    expect(m.gate).not.toHaveBeenCalled()
    await runAfter()
    expect(m.runDesignStep).toHaveBeenCalledWith({ sessionId: SID, runId: RID, jobId: 'job-1', githubRepo: 'o/r' })
    expect(m.chainOrFail).toHaveBeenCalledWith(m.db, SID, RID)
  })
  it('does not chain when the orchestrator says the run is done', async () => {
    m.shouldChain.mockReturnValue(false)
    await call({ authorization: 'Bearer s3cret' })
    await runAfter()
    expect(m.chainOrFail).not.toHaveBeenCalled()
  })
  it('valid bearer but a content job that is not editable → 409', async () => {
    m.db = fakeSupabase({ content_jobs: [{ data: { id: 'job-1', session_id: SID, phase: 5, github_repo: 'o/r' } }] }).client
    expect((await call({ authorization: 'Bearer s3cret' })).status).toBe(409)
  })
  it('400s a malformed run id', async () => {
    expect((await call({ authorization: 'Bearer s3cret' }, 'nope')).status).toBe(400)
  })
  it('404s a run that is not in this session', async () => {
    m.getRun.mockResolvedValue(null)
    expect((await call({ authorization: 'Bearer s3cret' })).status).toBe(404)
  })
})

describe('POST step — admin retry', () => {
  it('resumes a failed run from its first unfinished stage', async () => {
    m.getRun.mockResolvedValue(makeRunRow({ status: 'error' }))
    m.listConcepts.mockResolvedValue([makeConceptRow({ id: 'a', status: 'ready' }), makeConceptRow({ id: 'b', position: 1, status: 'error' })])
    m.transitionRun.mockResolvedValue(makeRunRow({ status: 'refining' }))
    const res = await call()
    expect(res.status).toBe(202)
    expect(m.transitionRun).toHaveBeenCalledWith(m.db, RID, ['error'], { status: 'refining', stage: 'render', error: null })
    expect(m.resetConcepts).toHaveBeenCalledWith(m.db, RID, ['b'])
  })
  it('nudges an active run without changing it', async () => {
    expect((await call()).status).toBe(202)
    expect(m.transitionRun).not.toHaveBeenCalled()
  })
  it('409s a finished run', async () => {
    m.getRun.mockResolvedValue(makeRunRow({ status: 'ready' }))
    expect((await call()).status).toBe(409)
  })
  it('409s a retry while another run is active', async () => {
    m.getRun.mockResolvedValue(makeRunRow({ status: 'error' }))
    m.transitionRun.mockRejectedValue(new ActiveRunExistsError(SID))
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Another design run is in progress for this client.' })
  })
})

describe('POST step — background failures', () => {
  it('errors the run when the worker crashes', async () => {
    m.runDesignStep.mockRejectedValue(new Error('boom'))
    await call({ authorization: 'Bearer s3cret' })
    await runAfter()
    expect(m.failActiveRun).toHaveBeenCalledWith(m.db, RID, 'The design step crashed — press Retry.')
  })
})
