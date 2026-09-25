import { describe, it, expect } from 'vitest'
import { asJson } from '@/lib/supabase/json-typed'
import { makeConceptRow, makeInputRow, makeRunRow } from './__fixtures__/rows'
import { nextAction, parseBaseSnapshot, parseScreenshots, planRetry, selectRunInputs } from './run-state'
import { DESIGN_STEP_MAX_LIFETIME_MS } from './run-types'

const c = (id: string, position: number, status: string, withBundle = true) =>
  makeConceptRow({ id, position, status, ...(withBundle ? {} : { bundle: null }) })

describe('nextAction', () => {
  it.each(['ready', 'applied', 'cancelled', 'error'])('stops on terminal status %s', (status) => {
    expect(nextAction(makeRunRow({ status }), []).kind).toBe('stop')
  })
  it('a queued run generates position 0', () => {
    expect(nextAction(makeRunRow({ status: 'queued' }), [])).toEqual({ kind: 'generate', position: 0 })
  })
  it('a generating run generates the next position (rejected rows count as done)', () => {
    const run = makeRunRow({ status: 'generating' })
    expect(nextAction(run, [c('a', 0, 'pending')])).toEqual({ kind: 'generate', position: 1 })
    expect(nextAction(run, [c('a', 0, 'pending'), c('b', 1, 'rejected', false)])).toEqual({ kind: 'generate', position: 2 })
  })
  it('fills the first missing position', () => {
    expect(nextAction(makeRunRow({ status: 'generating' }), [c('a', 0, 'pending'), c('d', 2, 'pending')])).toEqual({ kind: 'generate', position: 1 })
  })
  it('respects the run’s concept_count', () => {
    const run = makeRunRow({ status: 'generating', concept_count: 2 })
    expect(nextAction(run, [c('a', 0, 'pending'), c('b', 1, 'pending')])).toEqual({ kind: 'start-render' })
  })
  it('waits while a concept is being designed', () => {
    expect(nextAction(makeRunRow({ status: 'generating' }), [c('a', 0, 'pending'), c('b', 1, 'generating', false)]).kind).toBe('wait')
  })
  it('moves to render once every position exists and one is usable', () => {
    const run = makeRunRow({ status: 'generating' })
    expect(nextAction(run, [c('a', 0, 'rejected', false), c('b', 1, 'pending'), c('d', 2, 'rejected', false)])).toEqual({ kind: 'start-render' })
  })
  it('reports no-concepts when every position was rejected', () => {
    const run = makeRunRow({ status: 'generating' })
    expect(nextAction(run, [c('a', 0, 'rejected', false), c('b', 1, 'rejected', false), c('d', 2, 'rejected', false)])).toEqual({ kind: 'no-concepts' })
  })
  it('renders the first pending concept by position', () => {
    const run = makeRunRow({ status: 'refining', stage: 'render' })
    expect(nextAction(run, [c('b', 1, 'pending'), c('a', 0, 'ready'), c('d', 2, 'pending')])).toEqual({ kind: 'render', conceptId: 'b' })
  })
  it('waits while a render is in flight', () => {
    expect(nextAction(makeRunRow({ status: 'refining' }), [c('a', 0, 'refining'), c('b', 1, 'pending')]).kind).toBe('wait')
  })
  it('finalizes when nothing is left to render (rejected / bundle-less rows are ignored)', () => {
    const run = makeRunRow({ status: 'refining' })
    expect(nextAction(run, [c('a', 0, 'ready'), c('b', 1, 'rejected', false)])).toEqual({ kind: 'finalize' })
  })
})

describe('planRetry', () => {
  it('refuses a run that is not in error', () => {
    expect(planRetry(makeRunRow({ status: 'ready' }), []).ok).toBe(false)
  })
  it('generate stage: resumes at the first missing position, keeping accepted and rejected concepts', () => {
    const run = makeRunRow({ status: 'error', stage: 'generate' })
    expect(planRetry(run, [c('a', 0, 'pending'), c('b', 1, 'rejected', false)])).toEqual({
      ok: true,
      status: 'queued',
      stage: 'generate',
      resetConceptIds: [],
      deleteConceptIds: [],
    })
  })
  it('generate stage: an errored or stale generating position is deleted so it is regenerated', () => {
    const run = makeRunRow({ status: 'error', stage: 'generate' })
    expect(planRetry(run, [c('a', 0, 'pending'), c('b', 1, 'error', false)])).toMatchObject({ status: 'queued', deleteConceptIds: ['b'] })
    // makeConceptRow's updated_at is 2026-09-25T11:00Z; the step's max lifetime has passed.
    const later = Date.parse('2026-09-25T11:00:00.000Z') + DESIGN_STEP_MAX_LIFETIME_MS + 1
    expect(planRetry(run, [c('a', 0, 'pending'), c('b', 1, 'generating', false)], later)).toMatchObject({ status: 'queued', deleteConceptIds: ['b'] })
  })
  it('refuses while a generating row is younger than a step’s max lifetime (its worker may still be alive)', () => {
    const run = makeRunRow({ status: 'error', stage: 'generate' })
    const soon = Date.parse('2026-09-25T11:00:00.000Z') + DESIGN_STEP_MAX_LIFETIME_MS - 1_000
    expect(planRetry(run, [c('a', 0, 'pending'), c('b', 1, 'generating', false)], soon)).toEqual({
      ok: false,
      reason: 'A concept is still being designed — try again in a few minutes.',
    })
  })
  it('generate stage: a lone rejected concept is kept (no re-spend) and generation resumes after it', () => {
    expect(planRetry(makeRunRow({ status: 'error' }), [c('x', 0, 'rejected', false)])).toEqual({
      ok: true,
      status: 'queued',
      stage: 'generate',
      resetConceptIds: [],
      deleteConceptIds: [],
    })
  })
  it('regenerates from scratch when every position was rejected', () => {
    const run = makeRunRow({ status: 'error', stage: 'generate' })
    const all = [c('a', 0, 'rejected', false), c('b', 1, 'rejected', false), c('d', 2, 'rejected', false)]
    expect(planRetry(run, all)).toEqual({ ok: true, status: 'queued', stage: 'generate', resetConceptIds: [], deleteConceptIds: ['a', 'b', 'd'] })
  })
  it('resumes rendering and resets only the unfinished concepts', () => {
    const run = makeRunRow({ status: 'error', stage: 'render' })
    const plan = planRetry(run, [c('a', 0, 'ready'), c('b', 1, 'error'), c('d', 2, 'refining'), c('e', 3, 'pending')])
    expect(plan).toEqual({ ok: true, status: 'refining', stage: 'render', resetConceptIds: ['b', 'd'], deleteConceptIds: [] })
  })
  it('treats a run whose concepts already rendered as past generation, whatever its stage says', () => {
    const plan = planRetry(makeRunRow({ status: 'error', stage: 'generate' }), [c('a', 0, 'ready'), c('b', 1, 'error')])
    expect(plan).toMatchObject({ status: 'refining', stage: 'render', resetConceptIds: ['b'] })
  })
  it('render stage with nothing usable regenerates from scratch', () => {
    const run = makeRunRow({ status: 'error', stage: 'render' })
    expect(planRetry(run, [c('a', 0, 'rejected', false)])).toEqual({ ok: true, status: 'queued', stage: 'generate', resetConceptIds: [], deleteConceptIds: ['a'] })
  })
})

describe('snapshot parsing', () => {
  it('drops malformed screenshots and non-design paths', () => {
    expect(
      parseScreenshots([
        { viewport: 'desktop', path: 'design/s/runs/r/a.webp', width: 1440, height: 900 },
        { viewport: 'tv', path: 'design/s/x.webp', width: 1, height: 1 },
        { viewport: 'mobile', path: 'sessions/s/x.webp', width: 1, height: 1 },
        'junk',
      ])
    ).toEqual([{ viewport: 'desktop', path: 'design/s/runs/r/a.webp', width: 1440, height: 900 }])
  })
  it('defaults a missing base snapshot to the home page', () => {
    expect(parseBaseSnapshot(null)).toEqual({ pagePath: '/', themeShas: {}, screenshots: [], notes: [], metrics: null })
    expect(parseBaseSnapshot(asJson({ pagePath: '/services/tax', notes: ['a', 7] })).notes).toEqual(['a'])
  })
  it('parseBaseSnapshot reads the baseline metrics (null when absent or malformed)', () => {
    const metrics = { v: 1, viewports: [{ viewport: 'mobile', textChecked: 1, textUnverified: 0, contrast: [], overflow: null, hidden: [] }] }
    expect(parseBaseSnapshot({ pagePath: '/', themeShas: {}, screenshots: [], notes: [], metrics }).metrics).toEqual(metrics)
    expect(parseBaseSnapshot({ pagePath: '/' }).metrics).toBeNull()
    expect(parseBaseSnapshot({ pagePath: '/', metrics: { v: 9 } }).metrics).toBeNull()
  })
})

describe('selectRunInputs', () => {
  const ok = (id: string, extra = {}) => makeInputRow({ id, capture_status: 'ok', storage_path: `design/s/inputs/${id}.webp`, ...extra })
  it('keeps captured inputs in the chosen order and skips the rest with a reason', () => {
    const rows = [ok('a'), ok('b', { archived: true }), makeInputRow({ id: 'c', capture_status: 'error', label: 'Rival' }), ok('d')]
    const r = selectRunInputs(rows, ['d', 'b', 'c', 'zz', 'a'])
    expect(r.usable.map((u) => u.id)).toEqual(['d', 'a'])
    expect(r.skipped).toEqual([
      { label: 'Acme CPA', reason: 'it is archived' },
      { label: 'Rival', reason: 'it has not been captured yet' },
      { label: 'An input', reason: 'it was deleted' },
    ])
  })
  it('caps usable inputs at 5', () => {
    const rows = ['1', '2', '3', '4', '5', '6'].map((id) => ok(id))
    const r = selectRunInputs(rows, rows.map((x) => x.id))
    expect(r.usable).toHaveLength(5)
    expect(r.skipped[0].reason).toBe('the run already has 5 reference images')
  })
})
