import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { asJson } from '@/lib/supabase/json-typed'
import { fakeSupabase } from '@/lib/design/__fixtures__/fake-supabase'
import { makeConceptRow, makeRunRow } from '@/lib/design/__fixtures__/rows'
import { newReview } from '@/lib/design/review'
import { RUN_STALL_IDLE_MS } from '@/lib/design/run-state'
import { CRON_NUDGE_HOP } from '@/lib/design/run-nudge'

const m = vi.hoisted(() => ({ db: null as unknown, trigger: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => m.db }))
vi.mock('@/lib/design/run-trigger', () => ({ triggerDesignStep: m.trigger }))

import { GET } from './route'

const T = '2026-09-26T23:25:00.000Z'
const req = (auth?: string) => new Request('http://x/api/cron/nudge-design-runs', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 's3cret')
  vi.useFakeTimers({ now: Date.parse(T) + RUN_STALL_IDLE_MS + 1, toFake: ['Date'] })
  m.trigger.mockReset()
  m.db = fakeSupabase({
    design_runs: [{ data: [makeRunRow({ id: 'r1', session_id: 's1', status: 'refining', stage: 'critique', updated_at: T })] }],
    design_concepts: [
      { data: [makeConceptRow({ id: 'c1', run_id: 'r1', status: 'refining', updated_at: T, critique: asJson({ ...newReview(), next: 'revise' }) })] },
    ],
  }).client
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('GET /api/cron/nudge-design-runs', () => {
  it('fails closed with 500 when CRON_SECRET is unset — even for "Bearer undefined"', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(req('Bearer undefined'))).status).toBe(500)
    expect((await GET(req())).status).toBe(500)
    expect(m.trigger).not.toHaveBeenCalled()
  })

  it('401s a wrong or missing bearer without touching the DB', async () => {
    expect((await GET(req('Bearer nope'))).status).toBe(401)
    expect((await GET(req())).status).toBe(401)
    expect(m.trigger).not.toHaveBeenCalled()
  })

  it('nudges stalled runs as flagged nudges at the cron hop and reports counts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    m.trigger.mockResolvedValue('started')
    const res = await GET(req('Bearer s3cret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ nudged: 1, refused: 0 })
    expect(CRON_NUDGE_HOP).toBe(1)
    expect(m.trigger.mock.calls).toEqual([['s1', 'r1', { nudge: true, hop: CRON_NUDGE_HOP }]])
  })

  it('counts a refused trigger and still answers 200', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    m.trigger.mockResolvedValue('refused')
    const res = await GET(req('Bearer s3cret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ nudged: 0, refused: 1 })
  })
})
