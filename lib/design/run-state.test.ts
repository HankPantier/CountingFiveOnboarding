import { describe, it, expect } from 'vitest'
import { asJson } from '@/lib/supabase/json-typed'
import { makeConceptRow, makeInputRow, makeRunRow } from './__fixtures__/rows'
import { RUN_STALL_IDLE_MS, chainStalledAt, currentSiteCaption, hasStalledConcept, isRunStalled, inputAdminText, nextAction, parseBaseSnapshot, parseScreenshots, planRetry, selectRunInputs, usablePriors, CONCEPT_STILL_REFINING } from './run-state'
import { newReview } from './review'
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
  it('does NOT finalize while a concept was stopped mid-loop (error with a valid bundle): the run is stalled, for Retry', () => {
    const run = makeRunRow({ status: 'refining' })
    const swept = makeConceptRow({ id: 'b', position: 1, status: 'error', critique: asJson({ ...newReview(), next: 'revise' }) })
    expect(nextAction(run, [c('a', 0, 'ready'), swept])).toEqual({ kind: 'stalled' })
    // Swept during its first render (no review yet) — also stalled.
    expect(nextAction(run, [c('a', 0, 'ready'), c('b', 1, 'error')])).toEqual({ kind: 'stalled' })
    // A generation failure stores no bundle: nothing to resume.
    expect(nextAction(run, [c('a', 0, 'ready'), c('b', 1, 'error', false)])).toEqual({ kind: 'finalize' })
    // Work left elsewhere still runs first.
    expect(nextAction(run, [swept, c('a', 0, 'pending')])).toEqual({ kind: 'render', conceptId: 'a' })
  })
  it('hasStalledConcept ignores an error row whose bundle no longer validates', () => {
    expect(hasStalledConcept([makeConceptRow({ status: 'error', bundle: asJson({ nope: true }) })])).toBe(false)
    expect(hasStalledConcept([makeConceptRow({ status: 'error' })])).toBe(true)
    expect(hasStalledConcept([makeConceptRow({ status: 'ready' })])).toBe(false)
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
      resumeConceptIds: [],
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
      resumeConceptIds: [],
    })
  })
  it('regenerates from scratch when every position was rejected', () => {
    const run = makeRunRow({ status: 'error', stage: 'generate' })
    const all = [c('a', 0, 'rejected', false), c('b', 1, 'rejected', false), c('d', 2, 'rejected', false)]
    expect(planRetry(run, all)).toEqual({ ok: true, status: 'queued', stage: 'generate', resetConceptIds: [], deleteConceptIds: ['a', 'b', 'd'], resumeConceptIds: [] })
  })
  it('resumes rendering and resets only the unfinished concepts', () => {
    const run = makeRunRow({ status: 'error', stage: 'render' })
    const plan = planRetry(run, [c('a', 0, 'ready'), c('b', 1, 'error'), c('d', 2, 'refining'), c('e', 3, 'pending')])
    expect(plan).toEqual({ ok: true, status: 'refining', stage: 'render', resetConceptIds: ['b', 'd'], deleteConceptIds: [], resumeConceptIds: [] })
  })
  it('treats a run whose concepts already rendered as past generation, whatever its stage says', () => {
    const plan = planRetry(makeRunRow({ status: 'error', stage: 'generate' }), [c('a', 0, 'ready'), c('b', 1, 'error')])
    expect(plan).toMatchObject({ status: 'refining', stage: 'render', resetConceptIds: ['b'] })
  })
  it('render stage with nothing usable regenerates from scratch', () => {
    const run = makeRunRow({ status: 'error', stage: 'render' })
    expect(planRetry(run, [c('a', 0, 'rejected', false)])).toEqual({ ok: true, status: 'queued', stage: 'generate', resetConceptIds: [], deleteConceptIds: ['a'], resumeConceptIds: [] })
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

const loop = (id: string, position: number, over: Record<string, unknown> = {}, status = 'refining') =>
  makeConceptRow({ id, position, status, critique: asJson({ ...newReview(), ...over }) })

describe('nextAction — critique loop', () => {
  const run = makeRunRow({ status: 'refining', stage: 'render' })
  it('an unclaimed concept in its loop runs its next unit', () => {
    expect(nextAction(run, [loop('a', 0, { next: 'critique' })])).toEqual({ kind: 'critique', conceptId: 'a' })
    expect(nextAction(run, [loop('a', 0, { next: 'revise' })])).toEqual({ kind: 'revise', conceptId: 'a' })
    expect(nextAction(run, [loop('a', 0, { next: 'render' })])).toEqual({ kind: 'rerender', conceptId: 'a' })
    expect(nextAction(run, [loop('a', 0, { next: 'done' })])).toEqual({ kind: 'finish-concept', conceptId: 'a' })
  })
  it('waits while a unit holds the claim, or while a first render (no review yet) is in flight', () => {
    expect(nextAction(run, [loop('a', 0, { next: 'critique', claim: { unit: 'critique', at: '2026-09-25T12:00:00.000Z' } })]).kind).toBe('wait')
    expect(nextAction(run, [c('a', 0, 'refining')]).kind).toBe('wait')
  })
  it('finishes the looping concept before the next pending render', () => {
    expect(nextAction(run, [c('p', 0, 'pending'), loop('a', 1, { next: 'critique' })])).toEqual({ kind: 'critique', conceptId: 'a' })
    expect(nextAction(run, [loop('a', 0, {}, 'ready'), c('p', 1, 'pending')])).toEqual({ kind: 'render', conceptId: 'p' })
    expect(nextAction(run, [loop('a', 0, {}, 'ready')])).toEqual({ kind: 'finalize' })
  })
})

describe('planRetry — critique loop', () => {
  const failed = makeRunRow({ status: 'error', stage: 'critique' })
  const now = Date.parse('2026-09-25T12:00:00.000Z')
  it('resumes concepts that were mid-loop (refining or swept to error) instead of re-rendering them', () => {
    const plan = planRetry(failed, [loop('a', 0, { next: 'critique' }, 'error'), loop('b', 1, { next: 'revise' }), c('p', 2, 'pending')], now)
    expect(plan).toMatchObject({ ok: true, status: 'refining', resumeConceptIds: ['a', 'b'], resetConceptIds: [], deleteConceptIds: [] })
  })
  it('still resets a concept whose first render never produced a review (P3 behaviour)', () => {
    const plan = planRetry(failed, [c('a', 0, 'refining'), c('b', 1, 'ready')], now)
    expect(plan).toMatchObject({ ok: true, resetConceptIds: ['a'], resumeConceptIds: [] })
  })
  it('refuses while a loop unit’s claim is younger than a step’s lifetime', () => {
    const live = loop('a', 0, { next: 'critique', claim: { unit: 'critique', at: new Date(now - 60_000).toISOString() } })
    expect(planRetry(failed, [live], now)).toEqual({ ok: false, reason: CONCEPT_STILL_REFINING })
    const stale = loop('a', 0, { next: 'critique', claim: { unit: 'critique', at: new Date(now - DESIGN_STEP_MAX_LIFETIME_MS - 1).toISOString() } })
    expect(planRetry(failed, [stale], now)).toMatchObject({ ok: true, resumeConceptIds: ['a'] })
  })
  it('generation-stage retries carry an empty resume list', () => {
    const plan = planRetry(makeRunRow({ status: 'error', stage: 'generate' }), [], now)
    expect(plan.ok && plan.resumeConceptIds).toEqual([])
  })
})

describe('usablePriors', () => {
  it('returns the accepted concepts as priors, by position, optionally excluding one', () => {
    const rows = [c('b', 1, 'ready'), c('a', 0, 'refining'), c('r', 2, 'rejected', false)]
    expect(usablePriors(rows).map((p) => p.position)).toEqual([0, 1])
    expect(usablePriors(rows, 'a').map((p) => p.position)).toEqual([1])
  })
})

describe('nextAction — a concept parked mid-loop by a Retry (PF3)', () => {
  const run = makeRunRow({ status: 'refining', stage: 'critique' })
  it('resumes a pending concept that has a review instead of re-rendering it — only once nothing is refining', () => {
    const parked = loop('b', 1, { next: 'revise' }, 'pending')
    expect(nextAction(run, [loop('a', 0, { next: 'critique' }), parked])).toEqual({ kind: 'critique', conceptId: 'a' })
    expect(nextAction(run, [loop('a', 0, {}, 'ready'), parked])).toEqual({ kind: 'resume', conceptId: 'b' })
  })
  it('once resumed (refining again) it continues its loop at the unit its review names', () => {
    expect(nextAction(run, [loop('a', 0, {}, 'ready'), loop('b', 1, { next: 'revise' })])).toEqual({ kind: 'revise', conceptId: 'b' })
  })
})

describe('planRetry — a concept still parked from an earlier Retry (PF3)', () => {
  it('is resumed too (its claim cleared) rather than left pending or re-rendered', () => {
    const now = Date.parse('2026-09-25T12:00:00.000Z')
    const plan = planRetry(makeRunRow({ status: 'error', stage: 'critique' }), [loop('b', 1, { next: 'critique' }, 'pending'), loop('a', 0, { next: 'revise' }, 'error')], now)
    expect(plan).toMatchObject({ ok: true, resumeConceptIds: ['a', 'b'], resetConceptIds: [] })
  })
})

describe('prompt captions (shared by the orchestrator and the A/B script)', () => {
  it('captions the current-site render', () => {
    expect(currentSiteCaption('/services')).toBe('The client\'s CURRENT design of /services (desktop, 1440 px) — the "before" to improve on.')
  })
  it('joins an input\'s label + notes, or null when it has neither', () => {
    expect(inputAdminText(makeInputRow({ label: 'Rival', notes: 'love the hero' }))).toBe('Label: Rival\nNotes: love the hero')
    expect(inputAdminText(makeInputRow({ label: null, notes: 'n' }))).toBe('Notes: n')
    expect(inputAdminText(makeInputRow({ label: null, notes: null }))).toBeNull()
  })
})

describe('isRunStalled (a refused / dead self-chain the Studio or cron should nudge)', () => {
  const T0 = '2026-09-26T23:25:00.000Z'
  const t0 = Date.parse(T0)
  const at = (ms: number) => new Date(t0 + ms).toISOString()
  const snap = (extra: Record<string, unknown> = {}) => asJson({ pagePath: '/', themeShas: {}, screenshots: [], notes: [], ...extra })
  // The production incident: concept 0 refining with its critique done (next:
  // revise, no claim), concept 1 pending, the 5th hop refused with 508.
  const incident = (runOver: Partial<Parameters<typeof makeRunRow>[0]> = {}) => ({
    run: makeRunRow({ status: 'refining', stage: 'critique', concept_count: 2, updated_at: T0, ...runOver }),
    concepts: [
      makeConceptRow({ id: 'a', position: 0, status: 'refining', updated_at: T0, critique: asJson({ ...newReview(), next: 'revise' }) }),
      makeConceptRow({ id: 'b', position: 1, status: 'pending', updated_at: at(-60_000) }),
    ],
  })

  it('is stalled at once when the chain marker is newer than every write', () => {
    const { run, concepts } = incident({ base_snapshot: snap({ chainStalledAt: T0 }) })
    expect(isRunStalled(run, concepts, t0 + 1_000)).toBe(true)
  })
  it('ignores a marker older than a later write (a step moved the run on)', () => {
    const { run, concepts } = incident({ base_snapshot: snap({ chainStalledAt: at(-5_000) }) })
    expect(isRunStalled(run, concepts, t0 + 1_000)).toBe(false)
    const later = concepts.map((c) => (c.id === 'a' ? { ...c, updated_at: at(2_000) } : c))
    expect(isRunStalled({ ...run, base_snapshot: snap({ chainStalledAt: T0 }) }, later, t0 + 3_000)).toBe(false)
  })
  it('without a marker, is stalled only after RUN_STALL_IDLE_MS with no write', () => {
    const { run, concepts } = incident()
    expect(isRunStalled(run, concepts, t0 + RUN_STALL_IDLE_MS)).toBe(false)
    expect(isRunStalled(run, concepts, t0 + RUN_STALL_IDLE_MS + 1)).toBe(true)
  })
  it('is never stalled while a step holds a claim (a unit claim, a first render, a concept being designed) — even with a marker', () => {
    const marker = { base_snapshot: snap({ chainStalledAt: T0 }) }
    const late = t0 + 10 * RUN_STALL_IDLE_MS
    const claimed = makeConceptRow({ id: 'a', position: 0, status: 'refining', updated_at: T0, critique: asJson({ ...newReview(), next: 'revise', claim: { unit: 'revise', at: T0 } }) })
    expect(isRunStalled(makeRunRow({ status: 'refining', updated_at: T0, ...marker }), [claimed], late)).toBe(false)
    const firstRender = makeConceptRow({ id: 'a', position: 0, status: 'refining', updated_at: T0, critique: null })
    expect(isRunStalled(makeRunRow({ status: 'refining', updated_at: T0, ...marker }), [firstRender], late)).toBe(false)
    const designing = makeConceptRow({ id: 'a', position: 0, status: 'generating', bundle: null, updated_at: T0 })
    expect(isRunStalled(makeRunRow({ status: 'generating', updated_at: T0, ...marker }), [designing], late)).toBe(false)
  })
  it('covers every actionable stage: a queued run, between generate positions, and before finalize', () => {
    const late = t0 + RUN_STALL_IDLE_MS + 1
    expect(isRunStalled(makeRunRow({ status: 'queued', updated_at: T0 }), [], late)).toBe(true)
    expect(isRunStalled(makeRunRow({ status: 'generating', updated_at: T0 }), [makeConceptRow({ id: 'a', position: 0, updated_at: T0 })], late)).toBe(true)
    const done = makeConceptRow({ id: 'a', position: 0, status: 'ready', updated_at: T0 })
    expect(isRunStalled(makeRunRow({ status: 'refining', updated_at: T0, concept_count: 1 }), [done], late)).toBe(true)
  })
  it.each(['ready', 'applied', 'cancelled', 'error'])('a %s run is never stalled', (status) => {
    expect(isRunStalled(makeRunRow({ status, updated_at: T0, base_snapshot: snap({ chainStalledAt: T0 }) }), [], t0 + 10 * RUN_STALL_IDLE_MS)).toBe(false)
  })
  it('chainStalledAt reads only a valid timestamp', () => {
    expect(chainStalledAt({ chainStalledAt: T0 })).toBe(T0)
    expect(chainStalledAt({ chainStalledAt: 'soon' })).toBeNull()
    expect(chainStalledAt({ chainStalledAt: 5 })).toBeNull()
    expect(chainStalledAt(null)).toBeNull()
    expect(chainStalledAt([])).toBeNull()
  })
})
