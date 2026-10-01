import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', async (orig) => {
  const mod = await orig<typeof import('next/server')>()
  return { ...mod, after: (fn: () => unknown) => { void fn() } }
})
// vi.mock factories are hoisted above top-level consts, so the spies are too.
const { runQaForPage, maybeCompleteAfterQa, requireContentJobAccess } = vi.hoisted(() => ({
  runQaForPage: vi.fn().mockResolvedValue({ status: 'done' }),
  maybeCompleteAfterQa: vi.fn().mockResolvedValue(false),
  requireContentJobAccess: vi.fn(),
}))
vi.mock('@/lib/content/qa/run-qa', () => ({ runQaForPage }))
vi.mock('@/lib/content/content-generator', () => ({ maybeCompleteAfterQa }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/auth/access', () => ({ requireContentJobAccess }))

import { POST } from './route'

const req = (auth: string | null, body: unknown) =>
  new Request('https://x/api/content-jobs/j1/qa/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  })
const params = { params: Promise.resolve({ id: 'j1' }) }

beforeEach(() => { vi.stubEnv('CRON_SECRET', 'sek'); runQaForPage.mockClear(); requireContentJobAccess.mockReset() })

describe('POST /qa/run', () => {
  it('accepts the cron bearer and runs QA for the page', async () => {
    const res = await POST(req('Bearer sek', { pageId: 'p1' }), params)
    expect(res.status).toBe(202)
    expect(runQaForPage).toHaveBeenCalledWith('j1', 'p1')
  })
  it('falls back to the human gate without a bearer', async () => {
    const { NextResponse } = await import('next/server')
    requireContentJobAccess.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await POST(req(null, { pageId: 'p1' }), params)
    expect(res.status).toBe(401)
    expect(runQaForPage).not.toHaveBeenCalled()
  })
  it('400s without a pageId', async () => {
    const res = await POST(req('Bearer sek', {}), params)
    expect(res.status).toBe(400)
  })
  it('finishes the job after the page QA lands', async () => {
    maybeCompleteAfterQa.mockClear()
    await POST(req('Bearer sek', { pageId: 'p1' }), params)
    await vi.waitFor(() => expect(maybeCompleteAfterQa).toHaveBeenCalledWith({}, 'j1'))
  })
  it('a wrong bearer is not the internal path', async () => {
    const { NextResponse } = await import('next/server')
    requireContentJobAccess.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await POST(req('Bearer nope', { pageId: 'p1' }), params)
    expect(res.status).toBe(403)
    expect(runQaForPage).not.toHaveBeenCalled()
  })
})
