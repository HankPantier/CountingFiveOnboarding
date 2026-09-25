import { describe, it, expect, vi, beforeEach } from 'vitest'
import { asJson } from '@/lib/supabase/json-typed'
import { CID, RID, SID, makeConceptRow, makeRunRow } from './__fixtures__/rows'
import { BRAND_TEXT, DESIGN_TEXT, THEME_CSS_TEXT } from './__fixtures__/theme-texts'
import { VALID } from './__fixtures__/valid-bundle'
import { newReview, type ConceptReview } from './review'
import type { CritiqueRecord } from './critique'
import { DEFAULT_CAPABILITIES } from './run-types'

const m = vi.hoisted(() => ({
  getRun: vi.fn(),
  listConcepts: vi.fn(),
  transitionRun: vi.fn(),
  updateRunFields: vi.fn(async (..._a: unknown[]) => {}),
  claimConceptRender: vi.fn(),
  claimConceptUnit: vi.fn(),
  settleConceptUnit: vi.fn(),
  settleInitialRender: vi.fn(),
  texts: vi.fn(),
  loadShell: vi.fn(),
  renderFolds: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(async (..._a: unknown[]) => {}),
  gather: vi.fn(),
  critique: vi.fn(),
  revise: vi.fn(),
}))
vi.mock('./run-store', () => ({
  getRun: (...a: unknown[]) => m.getRun(...a),
  listConcepts: (...a: unknown[]) => m.listConcepts(...a),
  transitionRun: (...a: unknown[]) => m.transitionRun(...a),
  updateRunFields: (...a: unknown[]) => m.updateRunFields(...a),
  claimConceptRender: (...a: unknown[]) => m.claimConceptRender(...a),
  claimConceptUnit: (...a: unknown[]) => m.claimConceptUnit(...a),
  settleConceptUnit: (...a: unknown[]) => m.settleConceptUnit(...a),
  settleInitialRender: (...a: unknown[]) => m.settleInitialRender(...a),
}))
vi.mock('./theme-snapshot', () => ({ readDraftThemeTexts: (r: string) => m.texts(r) }))
vi.mock('./render/render-folds', () => ({
  loadRenderShell: (...a: unknown[]) => m.loadShell(...a),
  renderAndStoreFolds: (a: unknown) => m.renderFolds(a),
}))
vi.mock('./storage', () => ({
  downloadDesignImage: (...a: unknown[]) => m.download(...a),
  removeDesignPaths: (...a: unknown[]) => m.remove(...a),
}))
vi.mock('./run-gather', async (orig) => ({ ...((await orig()) as object), gatherBriefBasics: (...a: unknown[]) => m.gather(...a) }))
vi.mock('./critic', () => ({ critiqueConcept: (a: unknown) => m.critique(a) }))
vi.mock('./concept-reviser', () => ({ reviseConcept: (a: unknown) => m.revise(a) }))

import { capLoopNote, critiqueUnit, finishConceptUnit, renderUnit, reviseUnit } from './refine-stage'

const CTX = { sessionId: SID, runId: RID, jobId: 'job-1', githubRepo: 'o/r' }
const shot = (name: string, viewport: 'desktop' | 'mobile') => ({ viewport, path: `design/${SID}/runs/${RID}/${name}-${viewport}.webp`, width: 100, height: 100 })
const R0 = [shot('concept-0-r0', 'desktop'), shot('concept-0-r0', 'mobile')]
const R1 = [shot('concept-0-r1', 'desktop'), shot('concept-0-r1', 'mobile')]
const R2 = [shot('concept-0-r2', 'desktop'), shot('concept-0-r2', 'mobile')]
const CURRENT = [shot('current', 'desktop')]
const FILES = { brandText: BRAND_TEXT, designText: DESIGN_TEXT, themeCss: THEME_CSS_TEXT, overridesCss: '' }
const OK_METRICS = { v: 1 as const, viewports: [{ viewport: 'mobile' as const, textChecked: 5, textUnverified: 0, contrast: [], overflow: null, hidden: [] }] }
const BAD_METRICS = {
  v: 1 as const,
  viewports: [{ viewport: 'mobile' as const, textChecked: 5, textUnverified: 0, contrast: [], overflow: { scrollWidth: 430, viewportWidth: 390, offenders: [] }, hidden: [] }],
}
const RUN = makeRunRow({ status: 'refining', stage: 'render', base_snapshot: asJson({ pagePath: '/', themeShas: {}, screenshots: CURRENT, notes: [] }) })
const BASICS = { theme: FILES, current: VALID, caps: DEFAULT_CAPABILITIES, paletteFreedom: 'evolve', firmName: 'Acme CPA', schema: {}, designMd: null, blockSamples: '', shell: null, notes: [] }
const REVISED = { ...VALID, name: 'Harbor Ledger II', palette: { ...VALID.palette, primary: '#1f4d3d', action: '#f25c05' } }
const OXBLOOD = { ...VALID, name: 'Oxblood Ledger', palette: { ...VALID.palette, primary: '#5c1a2b', action: '#e0a526' } }
const crit = (passed: boolean): CritiqueRecord => {
  const s = passed ? 4 : 3
  return {
    iteration: 0,
    scores: { brandFit: s, distinctiveness: s, hierarchy: s, legibility: s, consistency: s, craft: s },
    reasons: { brandFit: '', distinctiveness: '', hierarchy: '', legibility: '', consistency: '', craft: '' },
    issues: [],
    summary: '',
    passed,
    mean: s,
    model: 'claude-opus-5-5',
    at: '2026-09-25T12:00:00.000Z',
  }
}
const looping = (over: Partial<ConceptReview> = {}, row: Record<string, unknown> = {}) =>
  makeConceptRow({
    status: 'refining',
    screenshots: asJson(R0),
    critique: asJson({ ...newReview(), next: 'critique', metrics: OK_METRICS, metricsIteration: 0, initialScreenshots: R0, ...over }),
    ...row,
  })
type UnitPatch = { status: string; review: ConceptReview; bundle?: unknown; iterations?: number; screenshots?: unknown; error?: string | null }
const unitPatch = (): UnitPatch => m.settleConceptUnit.mock.calls.at(-1)?.[3] as UnitPatch
const texts = (a: unknown) =>
  ((a as { prompt: { parts: { type: string; text?: string }[] } }).prompt.parts).flatMap((p) => (p.type === 'text' ? [p.text as string] : [])).join('\n')

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.getRun.mockResolvedValue(RUN)
  m.transitionRun.mockResolvedValue(RUN)
  m.texts.mockResolvedValue({ ok: true, files: FILES })
  m.loadShell.mockResolvedValue({ ok: true, shell: { origin: 'https://a.vercel.app', shellHtml: '<html><body></body></html>' }, path: '/' })
  m.renderFolds.mockResolvedValue({ shots: R0, desktopWebp: Buffer.from([1]), metrics: OK_METRICS, error: null })
  m.download.mockResolvedValue(new Uint8Array([7]))
  m.gather.mockResolvedValue({ ok: true, basics: BASICS })
  m.claimConceptUnit.mockImplementation(async (_db: unknown, _run: string, row: object) => ({ ...row, updated_at: '2026-09-25T12:00:00.001+00:00' }))
  m.settleConceptUnit.mockImplementation(async (_db: unknown, _run: string, claimed: object) => claimed)
  m.settleInitialRender.mockResolvedValue(makeConceptRow({ status: 'refining' }))
})

describe('renderUnit', () => {
  it('first render: claims pending → refining, renders concept-{p}-r0 with metrics, then queues the critique', async () => {
    const claimedRow = makeConceptRow({ status: 'refining', screenshots: asJson([]), updated_at: '2026-09-25T11:30:00.000+00:00' })
    m.claimConceptRender.mockResolvedValue(claimedRow)
    m.listConcepts.mockResolvedValue([makeConceptRow({ status: 'refining' })])
    const out = await renderUnit({} as never, CTX, RUN, CID, 'initial')
    expect(m.renderFolds).toHaveBeenCalledTimes(1) // the current site already has its render
    expect(m.renderFolds.mock.calls[0][0]).toMatchObject({ name: 'concept-0-r0', metrics: true })
    // A CAS on the row claimConceptRender returned.
    const [, runId, claimed, patch] = m.settleInitialRender.mock.calls[0] as [unknown, string, { id: string; updated_at: string }, UnitPatch]
    expect(runId).toBe(RID)
    expect(claimed).toMatchObject({ id: CID, updated_at: claimedRow.updated_at })
    expect(patch).toMatchObject({ status: 'refining', screenshots: R0, error: null })
    expect(patch.review).toMatchObject({ next: 'critique', metrics: OK_METRICS, metricsIteration: 0, initialScreenshots: R0, claim: null })
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ['refining'], { stage: 'render' })
    expect(out).toEqual({ kind: 'refined', unit: 'render', conceptId: CID, remaining: true })
  })

  it('first render of a run without a current-site render re-renders it first and drops the stale note', async () => {
    const bare = makeRunRow({
      status: 'refining',
      base_snapshot: asJson({ pagePath: '/', themeShas: {}, screenshots: [], notes: ['Current-site render skipped: The renderer is unavailable right now.', 'Input skipped — A: it is archived'] }),
    })
    m.getRun.mockResolvedValue(bare)
    m.claimConceptRender.mockResolvedValue(makeConceptRow({ status: 'refining' }))
    m.listConcepts.mockResolvedValue([makeConceptRow({ status: 'refining' })])
    await renderUnit({} as never, CTX, bare, CID, 'initial')
    expect(m.renderFolds.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(['current', 'concept-0-r0'])
    const snap = (m.transitionRun.mock.calls.find((c) => (c[3] as { baseSnapshot?: unknown }).baseSnapshot)?.[3] as { baseSnapshot: { notes: string[]; metrics: unknown } }).baseSnapshot
    expect(snap.notes).toEqual(['Input skipped — A: it is archived'])
    expect(snap.metrics).toEqual(OK_METRICS)
  })

  it('does not retry the current-site render once another concept of the run was rendered (no baseline mid-run)', async () => {
    const bare = makeRunRow({ status: 'refining', base_snapshot: asJson({ pagePath: '/', themeShas: {}, screenshots: [], notes: [] }) })
    m.getRun.mockResolvedValue(bare)
    m.claimConceptRender.mockResolvedValue(makeConceptRow({ id: 'c1', position: 1, status: 'refining' }))
    const earlier = makeConceptRow({ status: 'ready', screenshots: asJson(R0), critique: asJson({ ...newReview(), next: 'done', outcome: 'passed' }) })
    m.listConcepts.mockResolvedValue([earlier, makeConceptRow({ id: 'c1', position: 1, status: 'refining' })])
    await renderUnit({} as never, CTX, bare, 'c1', 'initial')
    expect(m.renderFolds.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(['concept-1-r0'])
    expect(m.transitionRun.mock.calls.some((c) => (c[3] as { baseSnapshot?: unknown }).baseSnapshot)).toBe(false)
  })

  it('no desktop render ends the loop: ready + not_rendered, still applicable; the last concept finalizes the run', async () => {
    m.claimConceptRender.mockResolvedValue(makeConceptRow({ status: 'refining' }))
    m.renderFolds.mockResolvedValue({ shots: [], desktopWebp: null, metrics: null, error: 'The renderer is unavailable right now.' })
    m.listConcepts.mockResolvedValue([makeConceptRow({ status: 'ready' })])
    const out = await renderUnit({} as never, CTX, RUN, CID, 'initial')
    const patch = m.settleInitialRender.mock.calls[0][3] as UnitPatch
    expect(patch.status).toBe('ready')
    expect(patch.review.outcome).toBe('not_rendered')
    expect(patch.review.notes[0]).toMatch(/^Render skipped: The renderer is unavailable right now\./)
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ['refining'], { status: 'ready', stage: 'ready' })
    expect(out).toMatchObject({ kind: 'refined', remaining: false })
  })

  it('a first render whose settle CAS misses (swept + re-claimed meanwhile) is a no-op and deletes nothing', async () => {
    m.claimConceptRender.mockResolvedValue(makeConceptRow({ status: 'refining', screenshots: asJson([shot('concept-0', 'desktop')]) }))
    m.settleInitialRender.mockResolvedValue(null)
    expect((await renderUnit({} as never, CTX, RUN, CID, 'initial')).kind).toBe('noop')
    expect(m.remove).not.toHaveBeenCalled()
  })

  it('re-render after a revision: CAS claim, concept-{p}-r{i}, deletes the superseded render but keeps the first', async () => {
    m.listConcepts.mockResolvedValue([looping({ next: 'render', metrics: null, metricsIteration: null }, { iterations: 2, screenshots: asJson(R1) })])
    m.renderFolds.mockResolvedValue({ shots: R2, desktopWebp: Buffer.from([1]), metrics: OK_METRICS, error: null })
    await renderUnit({} as never, CTX, RUN, CID, 'rerender')
    expect(m.claimConceptUnit.mock.calls[0][3]).toBe('render')
    expect((m.renderFolds.mock.calls[0][0] as { name: string }).name).toBe('concept-0-r2')
    expect(unitPatch().review).toMatchObject({ next: 'critique', initialScreenshots: R0, metricsIteration: 2, metrics: OK_METRICS })
    expect(m.remove).toHaveBeenCalledWith({}, R1.map((s) => s.path))
  })

  it('a retried re-render that rewrites the same deterministic paths deletes nothing it just wrote', async () => {
    m.listConcepts.mockResolvedValue([looping({ next: 'render', metrics: null, metricsIteration: null }, { iterations: 2, screenshots: asJson(R2) })])
    m.renderFolds.mockResolvedValue({ shots: R2, desktopWebp: Buffer.from([1]), metrics: OK_METRICS, error: null })
    await renderUnit({} as never, CTX, RUN, CID, 'rerender')
    expect(m.remove).not.toHaveBeenCalled()
  })

  it('a unit someone else holds is a no-op (no render)', async () => {
    m.listConcepts.mockResolvedValue([looping({ next: 'render', claim: { unit: 'render', at: '2026-09-25T12:00:00.000Z' } })])
    expect((await renderUnit({} as never, CTX, RUN, CID, 'rerender')).kind).toBe('noop')
    expect(m.renderFolds).not.toHaveBeenCalled()
    expect(m.claimConceptUnit).not.toHaveBeenCalled()
  })

  it('a lost CAS claim is a no-op (no render)', async () => {
    m.listConcepts.mockResolvedValue([looping({ next: 'render' }, { iterations: 1 })])
    m.claimConceptUnit.mockResolvedValue(null)
    expect((await renderUnit({} as never, CTX, RUN, CID, 'rerender')).kind).toBe('noop')
    expect(m.renderFolds).not.toHaveBeenCalled()
  })
})

describe('critiqueUnit', () => {
  const result = (critique: CritiqueRecord | null, over = {}) => ({ critique, errors: [], costUsd: 0.1, estimatedUsd: 0, stoppedReason: critique ? null : 'no_output', ...over })

  it('a pass ends the loop (ready, passed); spend is persisted BEFORE the concept is settled', async () => {
    m.listConcepts.mockResolvedValue([looping()])
    m.critique.mockResolvedValue(result(crit(true)))
    const order: string[] = []
    m.transitionRun.mockImplementation(async (_d: unknown, _r: string, _f: string[], patch: { costUsd?: number }) => {
      if (patch.costUsd !== undefined) order.push('spend')
      return RUN
    })
    m.settleConceptUnit.mockImplementation(async (_d: unknown, _r: string, claimed: object) => {
      order.push('settle')
      return claimed
    })
    await critiqueUnit({} as never, CTX, RID, CID, () => 1_000)
    expect(order).toEqual(['spend', 'settle'])
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ['refining'], { costUsd: 0.1 })
    expect(unitPatch()).toMatchObject({ status: 'ready' })
    expect(unitPatch().review).toMatchObject({ outcome: 'passed', next: 'done' })
    expect(unitPatch().review.critiques).toHaveLength(1)
    const args = m.critique.mock.calls[0][0] as { iteration: number; costSoFarUsd: number; deadline: number }
    expect(args).toMatchObject({ iteration: 0, costSoFarUsd: 0, deadline: 1_000 + 540_000 })
    expect(m.download).toHaveBeenCalledTimes(3) // current site + concept desktop + mobile
    expect(m.gather.mock.calls[0][4]).toEqual({ markup: false })
  })

  it('measures distinctness against the current site AND every other usable concept of the run', async () => {
    const other = makeConceptRow({ id: 'other', position: 1, status: 'pending', bundle: asJson(OXBLOOD) })
    const rejected = makeConceptRow({ id: 'rej', position: 2, status: 'rejected', bundle: null })
    m.listConcepts.mockResolvedValue([looping(), other, rejected])
    m.critique.mockResolvedValue(result(crit(true)))
    await critiqueUnit({} as never, CTX, RID, CID, () => 1_000)
    const prompt = texts(m.critique.mock.calls[0][0])
    expect(prompt).toContain('- vs the current site: ΔE')
    expect(prompt).toContain('- vs concept 2: ΔE')
    expect(prompt).not.toContain('- vs concept 3')
    expect(prompt).not.toContain('- vs concept 1:')
  })

  it('below the bar → revise next (still refining)', async () => {
    m.listConcepts.mockResolvedValue([looping()])
    m.critique.mockResolvedValue(result(crit(false)))
    await critiqueUnit({} as never, CTX, RID, CID, () => 1_000)
    expect(unitPatch()).toMatchObject({ status: 'refining' })
    expect(unitPatch().review.next).toBe('revise')
  })

  it('render-check failures force a revision even when the scores pass, and reach the prompt', async () => {
    m.listConcepts.mockResolvedValue([looping({ metrics: BAD_METRICS })])
    m.critique.mockResolvedValue(result(crit(true)))
    await critiqueUnit({} as never, CTX, RID, CID, () => 1_000)
    expect(unitPatch().review.next).toBe('revise')
    expect(texts(m.critique.mock.calls[0][0])).toContain('wider than the screen')
  })

  it('at the revision limit the loop ends (max_revisions)', async () => {
    m.listConcepts.mockResolvedValue([looping({}, { iterations: 2 })])
    m.critique.mockResolvedValue(result(crit(false)))
    await critiqueUnit({} as never, CTX, RID, CID, () => 1_000)
    expect(unitPatch().review).toMatchObject({ outcome: 'max_revisions', next: 'done' })
  })

  it('a run already at its cap ends the loop without a model call (re-read after the claim)', async () => {
    m.listConcepts.mockResolvedValue([looping()])
    m.getRun.mockResolvedValue({ ...RUN, cost_usd: 4 })
    await critiqueUnit({} as never, CTX, RID, CID, () => 1_000)
    expect(m.critique).not.toHaveBeenCalled()
    expect(unitPatch().review).toMatchObject({ outcome: 'cost_cap', notes: [capLoopNote(4)] })
    expect(m.getRun.mock.invocationCallOrder[0]).toBeGreaterThan(m.claimConceptUnit.mock.invocationCallOrder[0])
  })

  it('passes the re-read run cost (not the caller’s) to the model call', async () => {
    m.listConcepts.mockResolvedValue([looping()])
    m.getRun.mockResolvedValue({ ...RUN, cost_usd: 1.5 })
    m.critique.mockResolvedValue(result(crit(true)))
    await critiqueUnit({} as never, CTX, RID, CID, () => 1_000)
    expect((m.critique.mock.calls[0][0] as { costSoFarUsd: number }).costSoFarUsd).toBe(1.5)
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ['refining'], { costUsd: 1.6 })
  })

  it('no usable critique ends the loop as critic_unavailable', async () => {
    m.listConcepts.mockResolvedValue([looping()])
    m.critique.mockResolvedValue(result(null))
    await critiqueUnit({} as never, CTX, RID, CID, () => 1_000)
    expect(unitPatch().review.outcome).toBe('critic_unavailable')
  })

  it('a throw mid-call still persists the spend reported so far (onSpend) and ends the loop', async () => {
    m.listConcepts.mockResolvedValue([looping()])
    m.getRun.mockResolvedValue({ ...RUN, cost_usd: 1 })
    m.critique.mockImplementation(async (a: { onSpend: (usd: number) => void }) => {
      a.onSpend(0.25)
      throw new Error('boom')
    })
    await critiqueUnit({} as never, CTX, RID, CID, () => 1_000)
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ['refining'], { costUsd: 1.25 })
    expect(unitPatch()).toMatchObject({ status: 'ready' })
    expect(unitPatch().review.outcome).toBe('critic_unavailable')
  })

  it('spend on a run that moved on is still written (unguarded)', async () => {
    m.listConcepts.mockResolvedValue([looping()])
    m.critique.mockResolvedValue(result(crit(true)))
    m.transitionRun.mockImplementation(async (_d: unknown, _r: string, _f: string[], patch: { costUsd?: number }) => (patch.costUsd !== undefined ? null : RUN))
    await critiqueUnit({} as never, CTX, RID, CID, () => 1_000)
    expect(m.updateRunFields).toHaveBeenCalledWith({}, RID, { costUsd: 0.1 })
  })

  it('a failure AFTER the settle landed propagates (the step route errors the run) — no second settle, no swallowed no-op', async () => {
    m.listConcepts.mockResolvedValue([looping()])
    m.critique.mockResolvedValue(result(crit(false)))
    const blip = new Error('db blip')
    m.updateRunFields.mockRejectedValue(blip) // afterUnit's heartbeat
    await expect(critiqueUnit({} as never, CTX, RID, CID, () => 1_000)).rejects.toBe(blip)
    expect(m.settleConceptUnit).toHaveBeenCalledTimes(1)
    expect(unitPatch().review.next).toBe('revise')
  })

  it('a failure after an END-of-loop settle propagates too', async () => {
    m.listConcepts.mockResolvedValueOnce([looping()]).mockResolvedValueOnce([looping()])
    const blip = new Error('db blip')
    m.listConcepts.mockRejectedValueOnce(blip) // afterUnit's read
    m.critique.mockResolvedValue(result(crit(true)))
    await expect(critiqueUnit({} as never, CTX, RID, CID, () => 1_000)).rejects.toBe(blip)
    expect(m.settleConceptUnit).toHaveBeenCalledTimes(1)
    expect(unitPatch().review.outcome).toBe('passed')
  })

  it('the last loop to end fails the run (not ready) when another concept was stopped mid-review', async () => {
    const swept = makeConceptRow({ id: 'c1', position: 1, status: 'error', critique: asJson({ ...newReview(), next: 'revise' }) })
    m.listConcepts.mockResolvedValueOnce([looping(), swept]).mockResolvedValueOnce([looping(), swept]).mockResolvedValue([makeConceptRow({ status: 'ready' }), swept])
    m.critique.mockResolvedValue(result(crit(true)))
    const out = await critiqueUnit({} as never, CTX, RID, CID, () => 1_000)
    expect(out).toEqual({ kind: 'failed', error: 'A concept stopped mid-review — press Retry.' })
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ['refining'], { status: 'error', error: 'A concept stopped mid-review — press Retry.' })
    expect(m.transitionRun).not.toHaveBeenCalledWith({}, RID, ['refining'], { status: 'ready', stage: 'ready' })
  })

  it('a unit someone else holds makes no model call', async () => {
    m.listConcepts.mockResolvedValue([looping({ claim: { unit: 'critique', at: '2026-09-25T12:00:00.000Z' } })])
    expect((await critiqueUnit({} as never, CTX, RID, CID, () => 1_000)).kind).toBe('noop')
    expect(m.claimConceptUnit).not.toHaveBeenCalled()
    expect(m.critique).not.toHaveBeenCalled()
  })

  it('releases the claim (still refining, claim cleared) when the run is no longer refining', async () => {
    m.listConcepts.mockResolvedValue([looping()])
    m.getRun.mockResolvedValue({ ...RUN, status: 'cancelled' })
    const out = await critiqueUnit({} as never, CTX, RID, CID, () => 1_000)
    expect(out).toEqual({ kind: 'noop', reason: 'the run is no longer refining' })
    expect(m.critique).not.toHaveBeenCalled()
    const [, runId, claimed, patch] = m.settleConceptUnit.mock.calls[0] as [unknown, string, { updated_at: string }, UnitPatch]
    expect(runId).toBe(RID)
    expect(claimed.updated_at).toBe('2026-09-25T12:00:00.001+00:00') // the CLAIMED row's stamp
    expect(patch.status).toBe('refining')
    expect(patch.review).toMatchObject({ next: 'critique', claim: null })
  })
})

describe('reviseUnit', () => {
  it('a valid revision replaces the bundle, counts the round and queues a re-render (metrics cleared)', async () => {
    m.listConcepts.mockResolvedValue([looping({ next: 'revise', critiques: [crit(false)] })])
    m.revise.mockResolvedValue({ concept: { bundle: REVISED, files: FILES, notes: [] }, errors: [], notes: [], costUsd: 0.4, estimatedUsd: 0, stoppedReason: null })
    await reviseUnit({} as never, CTX, RID, CID, () => 1_000)
    expect(unitPatch()).toMatchObject({ status: 'refining', bundle: REVISED, iterations: 1 })
    expect(unitPatch().review).toMatchObject({ next: 'render', metrics: null, metricsIteration: null })
    expect(m.gather.mock.calls[0][4]).toEqual({ markup: true })
    expect(texts(m.revise.mock.calls[0][0])).toContain('revision round 1')
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ['refining'], { costUsd: 0.4 })
  })

  it('an unusable revision keeps the previous bundle and ends the loop', async () => {
    m.listConcepts.mockResolvedValue([looping({ next: 'revise', critiques: [crit(false)] })])
    m.revise.mockResolvedValue({ concept: null, errors: ['palette.primary: bad hex'], notes: [], costUsd: 0.4, estimatedUsd: 0, stoppedReason: 'no_output' })
    await reviseUnit({} as never, CTX, RID, CID, () => 1_000)
    const p = unitPatch()
    expect(p.status).toBe('ready')
    expect('bundle' in p).toBe(false)
    expect(p.review.outcome).toBe('invalid_revision')
    expect(p.review.notes[0]).toBe('Revision 1 was not usable (palette.primary: bad hex) — kept the previous version.')
  })

  it('a near-duplicate revision’s note drops the repair guidance meant for the model', async () => {
    m.listConcepts.mockResolvedValue([looping({ next: 'revise', critiques: [crit(false)] })])
    m.revise.mockResolvedValue({
      concept: null,
      errors: ['too similar to concept 2 ("Oxblood Ledger") — change the palette direction (primary/action) or at least two of fonts, tokens and treatments'],
      notes: [],
      costUsd: 0.4,
      estimatedUsd: 0,
      stoppedReason: 'no_output',
    })
    await reviseUnit({} as never, CTX, RID, CID, () => 1_000)
    expect(unitPatch().review.notes[0]).toBe('Revision 1 was not usable (too similar to concept 2 ("Oxblood Ledger")) — kept the previous version.')
  })

  it('a run already at its cap ends the loop without a model call', async () => {
    m.listConcepts.mockResolvedValue([looping({ next: 'revise', critiques: [crit(false)] })])
    m.getRun.mockResolvedValue({ ...RUN, cost_usd: 4 })
    await reviseUnit({} as never, CTX, RID, CID, () => 1_000)
    expect(m.revise).not.toHaveBeenCalled()
    expect(unitPatch().review).toMatchObject({ outcome: 'cost_cap', notes: [capLoopNote(4)] })
  })

  it('a failure AFTER the revision was settled propagates (the step route errors the run) — the new bundle is not undone', async () => {
    m.listConcepts.mockResolvedValue([looping({ next: 'revise', critiques: [crit(false)] })])
    m.revise.mockResolvedValue({ concept: { bundle: REVISED, files: FILES, notes: [] }, errors: [], notes: [], costUsd: 0.4, estimatedUsd: 0, stoppedReason: null })
    const blip = new Error('db blip')
    m.updateRunFields.mockRejectedValue(blip)
    await expect(reviseUnit({} as never, CTX, RID, CID, () => 1_000)).rejects.toBe(blip)
    expect(m.settleConceptUnit).toHaveBeenCalledTimes(1)
    expect(unitPatch()).toMatchObject({ status: 'refining', bundle: REVISED, iterations: 1 })
  })

  it('a throw mid-call persists the reported spend and keeps the previous bundle', async () => {
    m.listConcepts.mockResolvedValue([looping({ next: 'revise', critiques: [crit(false)] })])
    m.revise.mockImplementation(async (a: { onSpend: (usd: number) => void }) => {
      a.onSpend(0.3)
      throw new Error('boom')
    })
    await reviseUnit({} as never, CTX, RID, CID, () => 1_000)
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ['refining'], { costUsd: 0.3 })
    expect(unitPatch()).toMatchObject({ status: 'ready' })
    expect('bundle' in unitPatch()).toBe(false)
  })
})

describe('finishConceptUnit', () => {
  it('finishes a refining concept whose loop is done (CAS on the row as read) and finalizes the run', async () => {
    const row = looping({ next: 'done', outcome: 'passed' })
    m.listConcepts.mockResolvedValueOnce([row]).mockResolvedValueOnce([makeConceptRow({ status: 'ready' })])
    const out = await finishConceptUnit({} as never, RID, CID)
    const [, runId, claimed, patch] = m.settleConceptUnit.mock.calls[0] as [unknown, string, { updated_at: string }, UnitPatch]
    expect(runId).toBe(RID)
    expect(claimed.updated_at).toBe(row.updated_at)
    expect(patch).toMatchObject({ status: 'ready', review: { next: 'done', outcome: 'passed' } })
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ['refining'], { status: 'ready', stage: 'ready' })
    expect(out).toEqual({ kind: 'refined', unit: 'finish', conceptId: CID, remaining: false })
  })

  it('is a no-op for a claimed or non-refining concept, and when the CAS misses', async () => {
    m.listConcepts.mockResolvedValue([looping({ next: 'done', claim: { unit: 'critique', at: '2026-09-25T12:00:00.000Z' } })])
    expect((await finishConceptUnit({} as never, RID, CID)).kind).toBe('noop')
    m.listConcepts.mockResolvedValue([makeConceptRow({ status: 'ready', critique: asJson({ ...newReview(), next: 'done' }) })])
    expect((await finishConceptUnit({} as never, RID, CID)).kind).toBe('noop')
    expect(m.settleConceptUnit).not.toHaveBeenCalled()
    m.listConcepts.mockResolvedValue([looping({ next: 'done' })])
    m.settleConceptUnit.mockResolvedValue(null)
    expect((await finishConceptUnit({} as never, RID, CID)).kind).toBe('noop')
    expect(m.transitionRun).not.toHaveBeenCalled()
  })
})
