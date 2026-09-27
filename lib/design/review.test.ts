import { describe, it, expect } from 'vitest'
import { DESIGN_STEP_MAX_LIFETIME_MS } from './run-types'
import type { RenderMetrics } from './metrics'
import {
  UNMEASURED_WARNING,
  applyRenderGate,
  decideAfterCritique,
  dropAttemptNotes,
  endReview,
  isClaimLive,
  latestCritique,
  newReview,
  parseConceptReview,
  renderGateMessage,
  renderGateWarnings,
  unmeasuredViewportWarning,
  unmeasuredViewports,
  withCritique,
  withReviewNotes,
  critiqueForIteration,
  iterationBeats,
  iterationToRestore,
  withEvaluatedIteration,
  type IterationSnapshot,
} from './review'
import type { CritiqueRecord } from './critique'

const rec = (iteration: number, passed = false): CritiqueRecord => ({
  iteration,
  scores: { brandFit: 3, distinctiveness: 3, hierarchy: 3, legibility: 3, consistency: 3, craft: 3 },
  reasons: { brandFit: '', distinctiveness: '', hierarchy: '', legibility: '', consistency: '', craft: '' },
  issues: [],
  summary: '',
  passed,
  mean: 3,
  model: 'claude-opus-5-5',
  paletteFreedom: 'free',
  at: '2026-09-25T12:00:00.000Z',
})
const OVERFLOWING: RenderMetrics = {
  v: 1,
  viewports: [{ viewport: 'mobile', textChecked: 1, textUnverified: 0, contrast: [], overflow: { scrollWidth: 430, viewportWidth: 390, offenders: [] }, hidden: [] }],
}
const DESKTOP_CLEAN = { viewport: 'desktop' as const, textChecked: 1, textUnverified: 0, contrast: [], overflow: null, hidden: [] }
const BOTH_OVERFLOWING: RenderMetrics = { v: 1, viewports: [DESKTOP_CLEAN, ...OVERFLOWING.viewports] }
const DESKTOP_ONLY: RenderMetrics = { v: 1, viewports: [DESKTOP_CLEAN] }

describe('decideAfterCritique', () => {
  const base = { passed: false, gateFailures: 0, iterations: 0, maxRevisions: 2, capReached: false }
  it.each([
    [{ ...base, passed: true }, { kind: 'done', outcome: 'passed' }],
    [{ ...base, passed: true, gateFailures: 1 }, { kind: 'revise' }], // render failures force a revision
    [base, { kind: 'revise' }],
    [{ ...base, iterations: 2 }, { kind: 'done', outcome: 'max_revisions' }],
    [{ ...base, passed: true, gateFailures: 2, iterations: 2 }, { kind: 'done', outcome: 'max_revisions' }],
    [{ ...base, capReached: true }, { kind: 'done', outcome: 'cost_cap' }],
    [{ ...base, maxRevisions: 0 }, { kind: 'done', outcome: 'max_revisions' }],
  ])('%j → %j', (input, out) => expect(decideAfterCritique(input)).toEqual(out))
})

describe('review state', () => {
  it('round-trips through jsonb and rejects junk', () => {
    const r = withCritique({ ...newReview(), next: 'revise', metrics: OVERFLOWING, metricsIteration: 0 }, rec(0))
    expect(parseConceptReview(JSON.parse(JSON.stringify(r)))).toEqual(r)
    expect(parseConceptReview(null)).toBeNull()
    expect(parseConceptReview({ v: 1, next: 'dance' })).toBeNull()
  })
  it('keeps only the last 3 critiques; latestCritique is the newest', () => {
    let r = newReview()
    for (let i = 0; i < 5; i++) r = withCritique(r, rec(i))
    expect(r.critiques.map((c) => c.iteration)).toEqual([2, 3, 4])
    expect(latestCritique(r)?.iteration).toBe(4)
    expect(latestCritique(newReview())).toBeNull()
  })
  it('notes are de-duplicated and capped; endReview closes the loop', () => {
    const r = withReviewNotes(newReview(), ['a', 'a', ...Array.from({ length: 20 }, (_, i) => `n${i}`)])
    expect(r.notes[0]).toBe('a')
    expect(r.notes).toHaveLength(12)
    const done = endReview({ ...newReview(), claim: { unit: 'critique', at: 'x' } }, 'cost_cap', ['Stopped'])
    expect(done).toMatchObject({ next: 'done', outcome: 'cost_cap', claim: null, notes: ['Stopped'] })
  })
  it('a claim is live only within a step’s lifetime', () => {
    const now = Date.parse('2026-09-25T12:00:00.000Z')
    expect(isClaimLive(null, now)).toBe(false)
    expect(isClaimLive({ unit: 'critique', at: new Date(now - 60_000).toISOString() }, now)).toBe(true)
    expect(isClaimLive({ unit: 'critique', at: new Date(now - DESIGN_STEP_MAX_LIFETIME_MS - 1).toISOString() }, now)).toBe(false)
    expect(isClaimLive({ unit: 'critique', at: 'garbage' }, now)).toBe(false)
  })
  it('dropAttemptNotes removes notes that describe a failed attempt', () => {
    expect(
      dropAttemptNotes([
        'Current-site render skipped: The renderer is unavailable right now.',
        'Render skipped: The render timed out. — this version was not critiqued.',
        'The current-site render could not be re-read — concept 2 was designed without it.',
        'Input skipped — Acme: it is archived',
      ])
    ).toEqual(['Input skipped — Acme: it is archived'])
  })
})

describe('applyRenderGate (R6)', () => {
  it('refuses a concept whose latest render has gate failures', () => {
    const gate = applyRenderGate({ ...newReview(), metrics: OVERFLOWING }, null)
    expect(gate.ok).toBe(false)
    expect(!gate.ok && gate.failures[0]).toContain('wider than the screen')
  })
  it('passes when the baseline has the same failure', () => {
    expect(applyRenderGate({ ...newReview(), metrics: BOTH_OVERFLOWING }, BOTH_OVERFLOWING)).toEqual({ ok: true, warnings: [] })
  })
  it('a partly-measured render (mobile failed) is allowed with a warning naming the unmeasured viewport — never a silent pass', () => {
    expect(unmeasuredViewports(DESKTOP_ONLY)).toEqual(['mobile'])
    expect(unmeasuredViewports(BOTH_OVERFLOWING)).toEqual([])
    expect(unmeasuredViewports(null)).toEqual(['desktop', 'mobile'])
    const gate = applyRenderGate({ ...newReview(), metrics: DESKTOP_ONLY }, null)
    expect(gate).toEqual({ ok: true, warnings: [unmeasuredViewportWarning('mobile')] })
    expect(unmeasuredViewportWarning('mobile')).toContain('mobile (390)')
    expect(renderGateWarnings({ ...newReview(), metrics: DESKTOP_ONLY }, null)).toEqual([unmeasuredViewportWarning('mobile')])
  })
  it('a measured viewport’s failure still refuses a partly-measured render', () => {
    const gate = applyRenderGate({ ...newReview(), metrics: OVERFLOWING }, null)
    expect(gate.ok).toBe(false)
    expect(renderGateWarnings({ ...newReview(), metrics: OVERFLOWING }, null)).toEqual([])
  })
  it('allows an unmeasured concept (renderer unavailable / pre-P4) with a warning', () => {
    expect(applyRenderGate(null, null)).toEqual({ ok: true, warnings: [UNMEASURED_WARNING] })
    expect(applyRenderGate(newReview(), null)).toEqual({ ok: true, warnings: [UNMEASURED_WARNING] })
  })
  it('renderGateMessage lists up to 3 failures', () => {
    expect(renderGateMessage(['a', 'b', 'c', 'd'])).toBe('This concept fails the render checks, so it can’t be applied: a · b · c (+1 more)')
  })
})

describe('best iteration (WS-B)', () => {
  const snap = (iteration: number, over: { gate?: number; passed?: boolean; mean?: number; craft?: number; critique?: null } = {}): IterationSnapshot => ({
    iteration,
    bundle: { name: 'x' },
    screenshots: [],
    metrics: null,
    critique:
      over.critique === null
        ? null
        : { ...rec(iteration, over.passed ?? false), mean: over.mean ?? 3, scores: { ...rec(iteration).scores, craft: over.craft ?? 3 } },
    gateFailures: over.gate ?? 0,
  })

  it('ranks appliable first, then a pass, then mean, then craft; ties are not wins', () => {
    expect(iterationBeats(snap(1, { mean: 3 }), snap(2, { mean: 4, gate: 1 }))).toBe(true)
    expect(iterationBeats(snap(1, { passed: true, mean: 3.8 }), snap(2, { mean: 3.9 }))).toBe(true)
    expect(iterationBeats(snap(1, { mean: 3.5, craft: 4 }), snap(2, { mean: 3.33, craft: 2 }))).toBe(true)
    expect(iterationBeats(snap(1, { mean: 3.5, craft: 4 }), snap(2, { mean: 3.5, craft: 3 }))).toBe(true)
    expect(iterationBeats(snap(1, { mean: 3.5 }), snap(2, { mean: 3.5 }))).toBe(false)
    expect(iterationBeats(snap(1, { mean: 2 }), snap(2, { critique: null }))).toBe(true) // an uncritiqued skip ranks below
  })

  it('withEvaluatedIteration keeps a strictly better best, else takes the newer', () => {
    const r1 = withEvaluatedIteration(newReview(), snap(1, { mean: 3.5 }))
    expect(withEvaluatedIteration(r1, snap(2, { mean: 3.33 })).best?.iteration).toBe(1)
    expect(withEvaluatedIteration(r1, snap(2, { mean: 3.5 })).best?.iteration).toBe(2)
  })

  it('iterationToRestore: an evaluated loser falls back; an unjudged version only on a known gate failure vs an appliable best', () => {
    const review = { ...newReview(), best: snap(1, { mean: 3.5 }) }
    expect(iterationToRestore(review, { iteration: 2, evaluated: true, gateFailures: 0 })?.iteration).toBe(1)
    expect(iterationToRestore(review, { iteration: 1, evaluated: true, gateFailures: 0 })).toBeNull()
    expect(iterationToRestore(review, { iteration: 2, evaluated: false, gateFailures: 0 })).toBeNull()
    expect(iterationToRestore(review, { iteration: 2, evaluated: false, gateFailures: 2 })?.iteration).toBe(1)
    expect(iterationToRestore({ ...review, best: snap(1, { gate: 1 }) }, { iteration: 2, evaluated: false, gateFailures: 2 })).toBeNull()
    expect(iterationToRestore(newReview(), { iteration: 2, evaluated: true, gateFailures: 0 })).toBeNull()
  })

  it('round-trips through jsonb parsing and drops a malformed best', () => {
    const review = { ...newReview(), best: snap(1, { mean: 3.5 }) }
    expect(parseConceptReview(JSON.parse(JSON.stringify(review)))?.best).toMatchObject({ iteration: 1, gateFailures: 0 })
    expect(parseConceptReview({ ...review, best: { iteration: -1 } })).not.toHaveProperty('best')
  })

  it('critiqueForIteration shows the held iteration’s critique', () => {
    const review = { ...newReview(), critiques: [rec(0), rec(1), rec(2)] }
    expect(critiqueForIteration(review, 1)?.iteration).toBe(1)
    expect(critiqueForIteration({ critiques: [rec(2)], best: snap(0, { mean: 3.4 }) }, 0)?.mean).toBe(3.4)
    expect(critiqueForIteration({ critiques: [rec(0)] }, 1)?.iteration).toBe(0) // not yet critiqued: the one it answers
  })
})
