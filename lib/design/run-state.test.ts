import { describe, it, expect } from 'vitest'
import { asJson } from '@/lib/supabase/json-typed'
import { makeConceptRow, makeInputRow, makeRunRow } from './__fixtures__/rows'
import { nextAction, parseBaseSnapshot, parseScreenshots, planRetry, selectRunInputs } from './run-state'

const c = (id: string, position: number, status: string, withBundle = true) =>
  makeConceptRow({ id, position, status, ...(withBundle ? {} : { bundle: null }) })

describe('nextAction', () => {
  it.each(['ready', 'applied', 'cancelled', 'error'])('stops on terminal status %s', (status) => {
    expect(nextAction(makeRunRow({ status }), []).kind).toBe('stop')
  })
  it('generates a queued run', () => {
    expect(nextAction(makeRunRow({ status: 'queued' }), [])).toEqual({ kind: 'generate' })
  })
  it('waits while generation is in flight', () => {
    expect(nextAction(makeRunRow({ status: 'generating' }), []).kind).toBe('wait')
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
  it('regenerates from scratch when no concept has a bundle', () => {
    expect(planRetry(makeRunRow({ status: 'error' }), [c('x', 0, 'rejected', false)])).toEqual({
      ok: true,
      status: 'queued',
      stage: 'generate',
      resetConceptIds: [],
    })
  })
  it('resumes rendering and resets only the unfinished concepts', () => {
    const plan = planRetry(makeRunRow({ status: 'error' }), [c('a', 0, 'ready'), c('b', 1, 'error'), c('d', 2, 'refining'), c('e', 3, 'pending')])
    expect(plan).toEqual({ ok: true, status: 'refining', stage: 'render', resetConceptIds: ['b', 'd'] })
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
    expect(parseBaseSnapshot(null)).toEqual({ pagePath: '/', themeShas: {}, screenshots: [], notes: [] })
    expect(parseBaseSnapshot(asJson({ pagePath: '/services/tax', notes: ['a', 7] })).notes).toEqual(['a'])
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
