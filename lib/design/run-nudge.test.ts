import { describe, it, expect, vi, afterEach } from 'vitest'
import { asJson } from '@/lib/supabase/json-typed'
import { fakeSupabase } from './__fixtures__/fake-supabase'
import { makeConceptRow, makeRunRow } from './__fixtures__/rows'
import { newReview } from './review'
import { RUN_STALL_IDLE_MS } from './run-state'
import { DESIGN_RUN_NUDGE_MAX_IDLE_MS, nudgeStalledDesignRuns, pickStalledRuns } from './run-nudge'

vi.mock('./run-trigger', () => ({ triggerDesignStep: vi.fn() }))

afterEach(() => vi.restoreAllMocks())

const T = '2026-09-26T23:25:00.000Z'
const t = Date.parse(T)
const at = (ms: number) => new Date(t + ms).toISOString()
const run = (id: string, over: Parameters<typeof makeRunRow>[0] = {}) => makeRunRow({ id, session_id: `s-${id}`, status: 'refining', stage: 'critique', updated_at: T, ...over })
const loopConcept = (runId: string, over: Parameters<typeof makeConceptRow>[0] = {}, review: Record<string, unknown> = {}) =>
  makeConceptRow({ id: `c-${runId}`, run_id: runId, status: 'refining', updated_at: T, critique: asJson({ ...newReview(), next: 'revise', ...review }), ...over })

describe('pickStalledRuns', () => {
  const now = t + RUN_STALL_IDLE_MS + 1
  it('picks idle actionable runs and skips runs whose step holds a claim', () => {
    const runs = [run('a'), run('b')]
    const concepts = [loopConcept('a'), loopConcept('b', {}, { claim: { unit: 'revise', at: T } })]
    expect(pickStalledRuns(runs, concepts, now).map((r) => r.id)).toEqual(['a'])
  })
  it('skips a run still inside the idle window, and one idle past the nudge ceiling (left for the sweep)', () => {
    expect(pickStalledRuns([run('a')], [loopConcept('a')], t + 1000)).toEqual([])
    expect(pickStalledRuns([run('a')], [loopConcept('a')], t + DESIGN_RUN_NUDGE_MAX_IDLE_MS + 1)).toEqual([])
  })
  it('orders by oldest progress and caps the batch', () => {
    const runs = [run('new', { updated_at: at(1000) }), run('old', { updated_at: at(-1000) })]
    const concepts = [loopConcept('new', { updated_at: at(1000) }), loopConcept('old', { updated_at: at(-1000) })]
    expect(pickStalledRuns(runs, concepts, now + 2000).map((r) => r.id)).toEqual(['old', 'new'])
    expect(pickStalledRuns(runs, concepts, now + 2000, 1).map((r) => r.id)).toEqual(['old'])
  })
})

describe('nudgeStalledDesignRuns', () => {
  const now = t + RUN_STALL_IDLE_MS + 1
  it('calls the step route for each stalled run and reports the started ones', async () => {
    const f = fakeSupabase({
      design_runs: [{ data: [run('a'), run('b'), run('c')] }],
      design_concepts: [{ data: [loopConcept('a'), loopConcept('b'), loopConcept('c', {}, { claim: { unit: 'revise', at: T } })] }],
    })
    const trigger = vi.fn(async (_s: string, runId: string) => (runId === 'a' ? ('started' as const) : ('refused' as const)))
    expect(await nudgeStalledDesignRuns(f.client, now, trigger)).toEqual({ nudged: ['a'], refused: 1 })
    expect(trigger.mock.calls).toEqual([
      ['s-a', 'a'],
      ['s-b', 'b'],
    ])
    expect(f.opsFor('design_runs')).toContainEqual(['in', 'status', ['queued', 'capturing', 'generating', 'refining']])
  })
  it('does nothing without active runs, and never throws on a DB error', async () => {
    const trigger = vi.fn()
    const empty = fakeSupabase({ design_runs: [{ data: [] }] })
    expect(await nudgeStalledDesignRuns(empty.client, now, trigger)).toEqual({ nudged: [], refused: 0 })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = fakeSupabase({ design_runs: [{ error: { message: 'boom' } }] })
    expect(await nudgeStalledDesignRuns(broken.client, now, trigger)).toEqual({ nudged: [], refused: 0 })
    expect(trigger).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
  })
})
