import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CID, IID, RID, SID, makeConceptRow, makeInputRow, makeRunRow } from './__fixtures__/rows'
import { BRAND_TEXT, DESIGN_TEXT, THEME_CSS_TEXT } from './__fixtures__/theme-texts'
import { VALID } from './__fixtures__/valid-bundle'
import { asJson } from '@/lib/supabase/json-typed'
import { newReview } from './review'

const m = vi.hoisted(() => ({
  getRun: vi.fn(),
  listConcepts: vi.fn(),
  transitionRun: vi.fn(),
  updateRunFields: vi.fn(async (..._a: unknown[]) => {}),
  deleteConcepts: vi.fn(async (..._a: unknown[]) => {}),
  claimConceptPosition: vi.fn(),
  settleConceptGeneration: vi.fn(async (..._a: unknown[]) => null),
  resumeParkedConcept: vi.fn(),
  snapshot: vi.fn(),
  listInputs: vi.fn(),
  readSessionSchema: vi.fn(),
  download: vi.fn(),
  loadShell: vi.fn(),
  renderFolds: vi.fn(),
  generateConcept: vi.fn(),
  readFile: vi.fn(),
  renderUnit: vi.fn(),
  critiqueUnit: vi.fn(),
  reviseUnit: vi.fn(),
  finishConceptUnit: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('./run-store', () => ({
  getRun: (...a: unknown[]) => m.getRun(...a),
  listConcepts: (...a: unknown[]) => m.listConcepts(...a),
  transitionRun: (...a: unknown[]) => m.transitionRun(...a),
  updateRunFields: (...a: unknown[]) => m.updateRunFields(...a),
  deleteConcepts: (...a: unknown[]) => m.deleteConcepts(...a),
  claimConceptPosition: (...a: unknown[]) => m.claimConceptPosition(...a),
  settleConceptGeneration: (...a: unknown[]) => m.settleConceptGeneration(...a),
  resumeParkedConcept: (...a: unknown[]) => m.resumeParkedConcept(...a),
}))
vi.mock('./theme-snapshot', async (orig) => {
  const real = (await orig()) as typeof import('./theme-snapshot')
  return {
    ...real,
    readDraftThemeSnapshot: (r: string) => m.snapshot(r),
    readDraftThemeTexts: async (r: string) => real.themeTextsFromSnapshot(await m.snapshot(r)),
  }
})
vi.mock('./store', () => ({
  listInputs: (...a: unknown[]) => m.listInputs(...a),
  readSessionSchema: (...a: unknown[]) => m.readSessionSchema(...a),
}))
vi.mock('./storage', () => ({ downloadDesignImage: (...a: unknown[]) => m.download(...a) }))
vi.mock('./render/render-folds', () => ({
  loadRenderShell: (...a: unknown[]) => m.loadShell(...a),
  renderAndStoreFolds: (a: unknown) => m.renderFolds(a),
}))
vi.mock('./refine-stage', () => ({
  renderUnit: (...a: unknown[]) => m.renderUnit(...a),
  critiqueUnit: (...a: unknown[]) => m.critiqueUnit(...a),
  reviseUnit: (...a: unknown[]) => m.reviseUnit(...a),
  finishConceptUnit: (...a: unknown[]) => m.finishConceptUnit(...a),
}))
vi.mock('./concept-generator', () => ({ generateConcept: (a: unknown) => m.generateConcept(a) }))
vi.mock('@/lib/github/repo-files', () => {
  class FileNotFoundError extends Error {}
  return { DRAFT_BRANCH: 'draft', FileNotFoundError, readFile: (...a: unknown[]) => m.readFile(...a) }
})

import { FileNotFoundError } from '@/lib/github/repo-files'
import { runDesignStep, shouldChain } from './run-orchestrator'

const CTX = { sessionId: SID, runId: RID, jobId: 'job-1', githubRepo: 'o/r' }
const SNAP = {
  shas: { 'content/brand.json': 'a'.repeat(40), 'content/design.json': 'b'.repeat(40) },
  texts: { 'content/brand.json': BRAND_TEXT, 'content/design.json': DESIGN_TEXT, 'src/styles/theme.css': THEME_CSS_TEXT },
}
const SHELL = { origin: 'https://acme.vercel.app', shellHtml: '<html><head></head><body><section data-block="hero"><h1>Hi</h1></section></body></html>' }
const CURRENT_SHOT = { viewport: 'desktop', path: `design/${SID}/runs/${RID}/current-desktop-aaaaaaaa.webp`, width: 1440, height: 900 }
const FILES = { brandText: BRAND_TEXT, designText: DESIGN_TEXT, themeCss: '', overridesCss: '' }

beforeEach(() => {
  vi.resetAllMocks() // also drops unconsumed mockResolvedValueOnce queues
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  m.transitionRun.mockImplementation(async (_db: unknown, _id: string, _from: string[], patch: { status?: string }) =>
    makeRunRow({ status: patch.status ?? 'generating', input_ids: [IID] })
  )
  m.snapshot.mockResolvedValue(SNAP)
  m.listInputs.mockResolvedValue([makeInputRow({ capture_status: 'error' })])
  m.readSessionSchema.mockResolvedValue({ brand: { currentTone: 'Warm' } })
  m.readFile.mockRejectedValue(new FileNotFoundError('no design.md'))
  m.loadShell.mockResolvedValue({ ok: true, shell: SHELL, path: '/' })
  m.renderFolds.mockResolvedValue({ shots: [CURRENT_SHOT], desktopWebp: Buffer.from([1, 2, 3]), error: null })
  m.claimConceptPosition.mockImplementation(async (_db: unknown, c: { position: number }) =>
    makeConceptRow({ id: `claim-${c.position}`, position: c.position, status: 'generating', bundle: null, initial_bundle: null })
  )
  m.download.mockResolvedValue(new Uint8Array([9, 9]))
  m.generateConcept.mockResolvedValue({
    concept: { bundle: VALID, files: FILES, notes: [] },
    errors: [],
    costUsd: 0.5,
    estimatedUsd: 0,
    notes: ['model note'],
    stoppedReason: null,
  })
})

type Patch = { status?: string; stage?: string; costUsd?: number; error?: string; baseSnapshot?: { screenshots: unknown[]; notes: string[] } }
const transitions = () => m.transitionRun.mock.calls.map((c) => ({ from: c[2] as string[], patch: c[3] as Patch }))
const lastTransition = () => transitions().at(-1) as { from: string[]; patch: Patch }
const OXBLOOD = { ...VALID, name: 'Oxblood Ledger', palette: { ...VALID.palette, primary: '#5c1a2b', action: '#e0a526' } }
const pending = (position: number, bundle = VALID) => makeConceptRow({ id: `c${position}`, position, status: 'pending', bundle: asJson(bundle) })
const rejected = (position: number) => makeConceptRow({ id: `c${position}`, position, status: 'rejected', bundle: null, error: 'nope' })
const withCurrent = { base_snapshot: asJson({ pagePath: '/', themeShas: {}, screenshots: [CURRENT_SHOT], notes: ['earlier note'] }) }
const promptText = () =>
  ((m.generateConcept.mock.calls[0][0] as { prompt: { parts: { type: string; text?: string }[] } }).prompt.parts)
    .flatMap((p) => (p.type === 'text' ? [p.text as string] : []))
    .join('\n')

describe('runDesignStep — generate the first concept', () => {
  beforeEach(() => {
    m.getRun.mockResolvedValue(makeRunRow({ status: 'queued', input_ids: [IID] }))
    m.listConcepts.mockResolvedValue([])
  })

  it('claims the run and position 0, renders the current site, persists the base snapshot BEFORE the model call, then stores the concept and chains', async () => {
    const order: string[] = []
    m.transitionRun.mockImplementation(async (_db: unknown, _id: string, _from: string[], patch: Patch) => {
      order.push(patch.status ? `transition:${patch.status}` : patch.baseSnapshot && patch.costUsd === undefined ? 'snapshot' : 'persist')
      return makeRunRow({ status: patch.status ?? 'generating', input_ids: [IID] })
    })
    m.generateConcept.mockImplementation(async () => {
      order.push('model')
      return { concept: { bundle: VALID, files: FILES, notes: [] }, errors: [], costUsd: 0.5, estimatedUsd: 0, notes: ['model note'], stoppedReason: null }
    })
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'generated', position: 0, next: 'generate' })
    expect(shouldChain(out)).toBe(true)
    expect(order).toEqual(['transition:generating', 'snapshot', 'model', 'persist'])
    expect(transitions()[0]).toEqual({ from: ['queued'], patch: { status: 'generating', stage: 'generate', error: null } })
    expect(m.claimConceptPosition).toHaveBeenCalledWith({}, { runId: RID, sessionId: SID, position: 0 })
    expect(m.renderFolds).toHaveBeenCalledTimes(1)

    const snap = transitions()[1]
    expect(snap.from).toEqual(['generating'])
    expect(snap.patch.baseSnapshot?.screenshots).toEqual([CURRENT_SHOT])
    expect(snap.patch.baseSnapshot?.notes).toContain('Input skipped — Acme CPA: it has not been captured yet')
    expect((m.renderFolds.mock.calls[0][0] as { name: string; metrics?: boolean }).name).toBe('current')
    expect((m.renderFolds.mock.calls[0][0] as { metrics?: boolean }).metrics).toBe(true)

    const a = m.generateConcept.mock.calls[0][0] as { prompt: { parts: { type: string }[] }; priors: unknown[]; costSoFarUsd: number }
    expect(a.prompt.parts.some((p) => p.type === 'image')).toBe(true) // the current-site render
    expect(a.priors).toEqual([])
    expect(promptText()).toContain('You are designing concept 1 of 3')

    expect(m.settleConceptGeneration).toHaveBeenCalledWith({}, 'claim-0', { status: 'pending', bundle: VALID })
    const last = lastTransition()
    expect(last.from).toEqual(['generating'])
    expect(last.patch).toMatchObject({ costUsd: 0.5 })
    expect(last.patch.status).toBeUndefined() // still generating: more positions to go
    expect(last.patch.baseSnapshot?.notes).toContain('model note')
  })

  it('stores the current-site render’s metrics as the run baseline', async () => {
    const metrics = { v: 1, viewports: [{ viewport: 'mobile', textChecked: 2, textUnverified: 0, contrast: [], overflow: null, hidden: [] }] }
    m.renderFolds.mockResolvedValue({ shots: [CURRENT_SHOT], desktopWebp: Buffer.from([1]), metrics, error: null })
    await runDesignStep(CTX)
    const snap = transitions()[1].patch.baseSnapshot as { metrics?: unknown }
    expect(snap.metrics).toEqual(metrics)
  })

  it('is a no-op when another worker already claimed generation', async () => {
    m.transitionRun.mockResolvedValueOnce(null)
    expect(await runDesignStep(CTX)).toEqual({ kind: 'noop', reason: 'generation already claimed' })
    expect(m.generateConcept).not.toHaveBeenCalled()
    expect(m.claimConceptPosition).not.toHaveBeenCalled()
  })

  it('stops before the model call (and releases its claim) when the run was cancelled during the gather', async () => {
    m.transitionRun.mockImplementationOnce(async () => makeRunRow({ status: 'generating' })).mockImplementationOnce(async () => null)
    expect((await runDesignStep(CTX)).kind).toBe('noop')
    expect(m.generateConcept).not.toHaveBeenCalled()
    expect(m.deleteConcepts).toHaveBeenCalledWith({}, RID, ['claim-0'])
  })

  it('fails without a model call when the site has no design.json, marking its claim as failed', async () => {
    m.snapshot.mockResolvedValue({ shas: {}, texts: { 'content/brand.json': BRAND_TEXT } })
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'failed', error: 'This site has no brand.json / design.json yet.' })
    expect(m.generateConcept).not.toHaveBeenCalled()
    expect(m.settleConceptGeneration).toHaveBeenCalledWith({}, 'claim-0', { status: 'error', error: 'This site has no brand.json / design.json yet.' })
  })

  it('reads content/design.md through the shared optional-file reader', async () => {
    m.readFile.mockResolvedValue({ content: '# Design notes', sha: 'd'.repeat(40) })
    await runDesignStep(CTX)
    expect(m.readFile).toHaveBeenCalledWith('o/r', 'content/design.md', 'draft')
  })
})

describe('runDesignStep — later concepts', () => {
  beforeEach(() => {
    m.getRun.mockResolvedValue(makeRunRow({ status: 'generating', input_ids: [IID], cost_usd: 0.5, ...withCurrent }))
  })

  it('reuses the base snapshot: no re-render, re-downloads the current render, passes the accepted concepts as priors', async () => {
    m.listConcepts.mockResolvedValue([pending(0)])
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'generated', position: 1, next: 'generate' })
    expect(m.transitionRun.mock.calls.some((c) => (c[2] as string[]).includes('queued'))).toBe(false)
    expect(m.renderFolds).not.toHaveBeenCalled()
    expect(m.download).toHaveBeenCalledWith({}, CURRENT_SHOT.path)
    expect(m.claimConceptPosition).toHaveBeenCalledWith({}, { runId: RID, sessionId: SID, position: 1 })
    const a = m.generateConcept.mock.calls[0][0] as { priors: { position: number; bundle: { name: string } }[]; costSoFarUsd: number; prompt: { parts: { type: string }[] } }
    expect(a.priors.map((p) => [p.position, p.bundle.name])).toEqual([[0, 'Harbor Ledger']])
    expect(a.costSoFarUsd).toBe(0.5)
    expect(a.prompt.parts.some((p) => p.type === 'image')).toBe(true)
    expect(promptText()).toContain('You are designing concept 2 of 3')
    expect(promptText()).toContain('Concept 1 "Harbor Ledger"')
    const last = lastTransition()
    expect(last.patch.costUsd).toBe(1)
    expect(last.patch.baseSnapshot?.screenshots).toEqual([CURRENT_SHOT])
    expect(last.patch.baseSnapshot?.notes[0]).toBe('earlier note') // appended, never replaced
  })

  it('a rejected position is kept and generation continues at the next position', async () => {
    m.listConcepts.mockResolvedValue([pending(0)])
    m.generateConcept.mockResolvedValue({ concept: null, errors: ['palette.primary: must be a #rrggbb hex colour'], costUsd: 0.4, estimatedUsd: 0, notes: [], stoppedReason: 'no_output' })
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'generated', position: 1, next: 'generate' })
    const [, id, result] = m.settleConceptGeneration.mock.calls[0] as [unknown, string, { status: string; error: string }]
    expect(id).toBe('claim-1')
    expect(result.status).toBe('rejected')
    expect(result.error).toContain('palette.primary')
  })

  it('a position that ran out of time is rejected with our own message', async () => {
    m.listConcepts.mockResolvedValue([pending(0)])
    m.generateConcept.mockResolvedValue({ concept: null, errors: [], costUsd: 0.4, estimatedUsd: 0.4, notes: [], stoppedReason: 'deadline' })
    await runDesignStep(CTX)
    expect(m.settleConceptGeneration).toHaveBeenCalledWith({}, 'claim-1', { status: 'rejected', error: 'Ran out of time designing this concept.' })
  })

  it('persists cost_usd (guarded) BEFORE settling the concept row', async () => {
    m.listConcepts.mockResolvedValue([pending(0)])
    const order: string[] = []
    m.transitionRun.mockImplementation(async (_db: unknown, _id: string, _from: string[], patch: Patch) => {
      if (patch.costUsd !== undefined) order.push('persist')
      return makeRunRow({ status: patch.status ?? 'generating' })
    })
    m.settleConceptGeneration.mockImplementation(async () => {
      order.push('settle')
      return null
    })
    await runDesignStep(CTX)
    expect(order).toEqual(['persist', 'settle'])
  })

  it('re-reads cost_usd after claiming: spend an overlapping step recorded meanwhile is not overwritten', async () => {
    m.listConcepts.mockResolvedValue([pending(0)])
    m.getRun
      .mockReset()
      .mockResolvedValueOnce(makeRunRow({ status: 'generating', cost_usd: 0.5, ...withCurrent })) // step start
      .mockResolvedValue(makeRunRow({ status: 'generating', cost_usd: 1.2, ...withCurrent })) // after the claim
    await runDesignStep(CTX)
    expect((m.generateConcept.mock.calls[0][0] as { costSoFarUsd: number }).costSoFarUsd).toBe(1.2)
    expect(lastTransition().patch.costUsd).toBeCloseTo(1.7, 6)
  })

  it('re-checks the cap with the re-read cost and releases the claim when it is already reached', async () => {
    m.listConcepts.mockResolvedValue([pending(0)])
    m.getRun
      .mockReset()
      .mockResolvedValueOnce(makeRunRow({ status: 'generating', cost_usd: 0.5, ...withCurrent }))
      .mockResolvedValue(makeRunRow({ status: 'generating', cost_usd: 4, ...withCurrent }))
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'generated', position: null, next: 'render' })
    expect(m.generateConcept).not.toHaveBeenCalled()
    expect(m.deleteConcepts).toHaveBeenCalledWith({}, RID, ['claim-1'])
    expect(lastTransition().patch.baseSnapshot?.notes).toContain('Stopped at the $4.00 cap after 1 concept.')
  })

  it('the last position moves the run to render', async () => {
    m.listConcepts.mockResolvedValue([pending(0), rejected(1)])
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'generated', position: 2, next: 'render' })
    expect(shouldChain(out)).toBe(true)
    expect(lastTransition()).toMatchObject({ from: ['generating'], patch: { status: 'refining', stage: 'render', costUsd: 1 } })
  })

  it('errors the run with our own message when every position was rejected', async () => {
    m.listConcepts.mockResolvedValue([rejected(0), rejected(1)])
    m.generateConcept.mockResolvedValue({ concept: null, errors: ['bad'], costUsd: 0.4, estimatedUsd: 0, notes: [], stoppedReason: 'no_output' })
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'failed', error: 'The model returned no usable concepts — press Retry.' })
    expect(lastTransition()).toMatchObject({ from: ['generating'], patch: { status: 'error', costUsd: 0.9 } })
  })

  it('a duplicate step for a position that is already claimed is a no-op (no model call)', async () => {
    m.listConcepts.mockResolvedValue([pending(0)])
    m.claimConceptPosition.mockResolvedValue(null)
    expect(await runDesignStep(CTX)).toEqual({ kind: 'noop', reason: 'concept 2 already claimed' })
    expect(m.generateConcept).not.toHaveBeenCalled()
    expect(m.transitionRun).not.toHaveBeenCalled()
  })

  it('waits (no claim) while another step is designing a concept', async () => {
    m.listConcepts.mockResolvedValue([pending(0), makeConceptRow({ id: 'c1', position: 1, status: 'generating', bundle: null })])
    expect((await runDesignStep(CTX)).kind).toBe('noop')
    expect(m.claimConceptPosition).not.toHaveBeenCalled()
  })

  describe('cost cap', () => {
    it('stopped mid-run: drops the unfinished claim and moves to render with a note', async () => {
      m.listConcepts.mockResolvedValue([pending(0)])
      m.generateConcept.mockResolvedValue({ concept: null, errors: [], costUsd: 0, estimatedUsd: 0, notes: [], stoppedReason: 'cost_cap' })
      const out = await runDesignStep(CTX)
      expect(out).toEqual({ kind: 'generated', position: 1, next: 'render' })
      expect(m.deleteConcepts).toHaveBeenCalledWith({}, RID, ['claim-1'])
      const last = lastTransition()
      expect(last.patch).toMatchObject({ status: 'refining', stage: 'render' })
      expect(last.patch.baseSnapshot?.notes).toContain('Stopped at the $4.00 cap after 1 concept.')
    })

    it('a concept that answered but could not be repaired under the cap is kept as rejected', async () => {
      m.listConcepts.mockResolvedValue([pending(0)])
      m.generateConcept.mockResolvedValue({ concept: null, errors: ['palette.primary: bad'], costUsd: 0.2, estimatedUsd: 0, notes: [], stoppedReason: 'cost_cap' })
      await runDesignStep(CTX)
      expect(m.settleConceptGeneration).toHaveBeenCalledWith({}, 'claim-1', { status: 'rejected', error: 'palette.primary: bad' })
      expect(lastTransition().patch).toMatchObject({ status: 'refining', stage: 'render' })
    })

    it('is checked before claiming: a run already at its cap moves to render without a model call', async () => {
      m.getRun.mockResolvedValue(makeRunRow({ status: 'generating', cost_usd: 4, cost_cap_usd: 4, ...withCurrent }))
      m.listConcepts.mockResolvedValue([pending(0), pending(1, OXBLOOD)])
      const out = await runDesignStep(CTX)
      expect(out).toEqual({ kind: 'generated', position: null, next: 'render' })
      expect(m.claimConceptPosition).not.toHaveBeenCalled()
      expect(m.generateConcept).not.toHaveBeenCalled()
      expect(lastTransition().patch.baseSnapshot?.notes).toContain('Stopped at the $4.00 cap after 2 concepts.')
    })

    it('a call that pushes the run over its cap ends generation right away', async () => {
      m.getRun.mockResolvedValue(makeRunRow({ status: 'generating', cost_usd: 3.8, cost_cap_usd: 4, ...withCurrent }))
      m.listConcepts.mockResolvedValue([pending(0)])
      const out = await runDesignStep(CTX)
      expect(out).toEqual({ kind: 'generated', position: 1, next: 'render' })
      expect(lastTransition().patch).toMatchObject({ status: 'refining', stage: 'render' })
      expect(lastTransition().patch.costUsd).toBeCloseTo(4.3, 6)
      expect(lastTransition().patch.baseSnapshot?.notes).toContain('Stopped at the $4.00 cap after 2 concepts.')
    })

    it('adds the cap note when the cap stops the LAST position’s call too', async () => {
      m.listConcepts.mockResolvedValue([pending(0), pending(1, OXBLOOD)])
      m.generateConcept.mockResolvedValue({ concept: null, errors: [], costUsd: 0, estimatedUsd: 0, notes: [], stoppedReason: 'cost_cap' })
      await runDesignStep(CTX)
      expect(lastTransition().patch).toMatchObject({ status: 'refining', stage: 'render' })
      expect(lastTransition().patch.baseSnapshot?.notes).toContain('Stopped at the $4.00 cap after 2 concepts.')
    })

    it('errors the run when the cap stops generation before any concept was usable', async () => {
      m.getRun.mockResolvedValue(makeRunRow({ status: 'generating', cost_usd: 4, cost_cap_usd: 4, ...withCurrent }))
      m.listConcepts.mockResolvedValue([rejected(0)])
      const out = await runDesignStep(CTX)
      expect(out).toEqual({ kind: 'failed', error: 'The run hit its cost cap before any concept was usable.' })
    })
  })

  describe('spend', () => {
    it('still records the cost when the run is cancelled during generation', async () => {
      m.listConcepts.mockResolvedValue([pending(0)])
      m.transitionRun.mockImplementationOnce(async () => makeRunRow({ status: 'generating' })).mockImplementationOnce(async () => null)
      expect((await runDesignStep(CTX)).kind).toBe('noop')
      expect(m.updateRunFields).toHaveBeenCalledWith({}, RID, { costUsd: 1 })
    })

    it('persists the spend, marks the claim failed and fails with our own message when a write after generation throws', async () => {
      m.listConcepts.mockResolvedValue([pending(0)])
      m.settleConceptGeneration.mockRejectedValueOnce(new Error('settle: db down')).mockResolvedValue(null)
      const out = await runDesignStep(CTX)
      expect(out).toEqual({ kind: 'failed', error: 'Concept generation failed — press Retry.' })
      expect(m.settleConceptGeneration).toHaveBeenLastCalledWith({}, 'claim-1', { status: 'error', error: 'Concept generation failed — press Retry.' })
      expect(lastTransition()).toEqual({ from: ['generating'], patch: { status: 'error', error: 'Concept generation failed — press Retry.', costUsd: 1 } })
    })

    it('still persists the spend when the failing run was cancelled meanwhile', async () => {
      m.listConcepts.mockResolvedValue([pending(0)])
      m.settleConceptGeneration.mockRejectedValueOnce(new Error('db down'))
      m.transitionRun.mockImplementationOnce(async () => makeRunRow({ status: 'generating' })).mockImplementationOnce(async () => null)
      expect((await runDesignStep(CTX)).kind).toBe('failed')
      expect(m.updateRunFields).toHaveBeenCalledWith({}, RID, { costUsd: 1 })
    })

    it('does not touch cost when generation throws before reporting any spend', async () => {
      m.listConcepts.mockResolvedValue([pending(0)])
      m.generateConcept.mockRejectedValueOnce(new Error('boom'))
      expect((await runDesignStep(CTX)).kind).toBe('failed')
      expect(lastTransition().patch).toEqual({ status: 'error', error: 'Concept generation failed — press Retry.' })
      expect(m.updateRunFields).not.toHaveBeenCalled()
    })

    it('persists the reported spend when generation throws after a model call was accounted', async () => {
      m.listConcepts.mockResolvedValue([pending(0)])
      m.generateConcept.mockImplementationOnce(async (a: { onSpend?: (usd: number) => void }) => {
        a.onSpend?.(0.3)
        a.onSpend?.(0.6)
        throw new Error('validateConceptBundle: unexpected token')
      })
      const out = await runDesignStep(CTX)
      expect(out).toEqual({ kind: 'failed', error: 'Concept generation failed — press Retry.' })
      expect(lastTransition()).toEqual({ from: ['generating'], patch: { status: 'error', error: 'Concept generation failed — press Retry.', costUsd: 1.1 } })
    })
  })
})

describe('runDesignStep — every position already exists', () => {
  it('a (retried) run whose positions are all settled moves straight to render', async () => {
    m.getRun.mockResolvedValue(makeRunRow({ status: 'queued', ...withCurrent }))
    m.listConcepts.mockResolvedValue([pending(0), rejected(1), pending(2, OXBLOOD)])
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'generated', position: null, next: 'render' })
    expect(lastTransition()).toMatchObject({ from: ['queued', 'generating'], patch: { status: 'refining', stage: 'render' } })
    expect(m.generateConcept).not.toHaveBeenCalled()
  })
})

describe('runDesignStep — critique loop dispatch', () => {
  const refining = makeRunRow({ status: 'refining', stage: 'render' })
  const unitOut = { kind: 'refined', unit: 'render', conceptId: 'c0', remaining: true }
  beforeEach(() => {
    m.getRun.mockResolvedValue(refining)
    for (const f of [m.renderUnit, m.critiqueUnit, m.reviseUnit, m.finishConceptUnit]) f.mockResolvedValue(unitOut)
  })
  const inLoop = (next: string) => makeConceptRow({ id: 'c0', position: 0, status: 'refining', critique: asJson({ v: 1, next, claim: null, metrics: null, metricsIteration: null, initialScreenshots: [], critiques: [], outcome: null, notes: [] }) })

  it('renders the first pending concept (initial)', async () => {
    m.listConcepts.mockResolvedValue([pending(0), pending(1, OXBLOOD)])
    expect(await runDesignStep(CTX)).toEqual(unitOut)
    expect(m.renderUnit).toHaveBeenCalledWith({}, CTX, refining, 'c0', 'initial')
  })
  it.each([
    ['critique', 'critiqueUnit'],
    ['revise', 'reviseUnit'],
  ] as const)('dispatches a %s unit with the step clock', async (next, fn) => {
    m.listConcepts.mockResolvedValue([inLoop(next), pending(1, OXBLOOD)])
    const now = () => 42
    await runDesignStep(CTX, now)
    expect(m[fn]).toHaveBeenCalledWith({}, CTX, RID, 'c0', now)
  })
  it('re-renders after a revision and finishes a concept whose loop is done', async () => {
    m.listConcepts.mockResolvedValue([inLoop('render')])
    await runDesignStep(CTX)
    expect(m.renderUnit).toHaveBeenCalledWith({}, CTX, refining, 'c0', 'rerender')
    m.listConcepts.mockResolvedValue([inLoop('done')])
    await runDesignStep(CTX)
    expect(m.finishConceptUnit).toHaveBeenCalledWith({}, RID, 'c0')
  })
  it('finalizes when every concept is ready', async () => {
    m.listConcepts.mockResolvedValue([makeConceptRow({ id: 'c0', status: 'ready' })])
    expect(await runDesignStep(CTX)).toEqual({ kind: 'finalized' })
  })
  it('fails (not finalizes) the run when a concept was stopped mid-loop, so Retry can resume it', async () => {
    const swept = makeConceptRow({ id: 'c1', position: 1, status: 'error', critique: asJson({ ...newReview(), next: 'critique' }) })
    m.listConcepts.mockResolvedValue([makeConceptRow({ id: 'c0', status: 'ready' }), swept])
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'failed', error: 'A concept stopped mid-review — press Retry.' })
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ['refining'], { status: 'error', error: 'A concept stopped mid-review — press Retry.' })
    expect(m.transitionRun).not.toHaveBeenCalledWith({}, RID, ['refining'], { status: 'ready', stage: 'ready' })
    expect(shouldChain(out)).toBe(false)
  })
})

describe('runDesignStep — a concept parked mid-loop by a Retry', () => {
  const parked = () => makeConceptRow({ status: 'pending', critique: asJson({ ...newReview(), next: 'revise' }) })
  beforeEach(() => {
    m.getRun.mockResolvedValue(makeRunRow({ status: 'refining', stage: 'critique' }))
    m.listConcepts.mockResolvedValue([parked()])
  })
  it('resumes it (back to refining, CAS on the row as read) and chains — no render, no model call', async () => {
    m.resumeParkedConcept.mockResolvedValue(makeConceptRow({ status: 'refining' }))
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'resumed', conceptId: CID })
    expect(shouldChain(out)).toBe(true)
    expect(m.resumeParkedConcept).toHaveBeenCalledWith({}, RID, expect.objectContaining({ id: CID, updated_at: parked().updated_at }))
    expect(m.renderUnit).not.toHaveBeenCalled()
    expect(m.generateConcept).not.toHaveBeenCalled()
  })
  it('is a no-op when another step already resumed it (CAS miss) — and does not chain', async () => {
    m.resumeParkedConcept.mockResolvedValue(null)
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'noop', reason: 'concept already resumed' })
    expect(shouldChain(out)).toBe(false)
    expect(m.renderUnit).not.toHaveBeenCalled()
  })
  it('resumes the first parked concept by position, after the finished ones', async () => {
    const later = makeConceptRow({ id: 'p2', position: 2, status: 'pending', critique: asJson({ ...newReview(), next: 'critique' }) })
    const first = makeConceptRow({ id: 'p1', position: 1, status: 'pending', critique: asJson({ ...newReview(), next: 'revise' }) })
    m.listConcepts.mockResolvedValue([later, makeConceptRow({ id: 'r0', position: 0, status: 'ready' }), first])
    m.resumeParkedConcept.mockResolvedValue(makeConceptRow({ id: 'p1', status: 'refining' }))
    expect(await runDesignStep(CTX)).toEqual({ kind: 'resumed', conceptId: 'p1' })
    expect(m.resumeParkedConcept).toHaveBeenCalledTimes(1)
    expect(m.resumeParkedConcept).toHaveBeenCalledWith({}, RID, expect.objectContaining({ id: 'p1', updated_at: first.updated_at }))
  })
})

describe('runDesignStep — terminal', () => {
  it.each(['ready', 'applied', 'cancelled', 'error'])('does nothing for a %s run', async (status) => {
    m.getRun.mockResolvedValue(makeRunRow({ status }))
    m.listConcepts.mockResolvedValue([])
    expect((await runDesignStep(CTX)).kind).toBe('noop')
  })
})

describe('shouldChain', () => {
  it('chains after generation and after a loop unit with work left; stops otherwise', () => {
    expect(shouldChain({ kind: 'generated', position: 0, next: 'generate' })).toBe(true)
    expect(shouldChain({ kind: 'refined', unit: 'critique', conceptId: 'c', remaining: true })).toBe(true)
    expect(shouldChain({ kind: 'refined', unit: 'render', conceptId: 'c', remaining: false })).toBe(false)
    expect(shouldChain({ kind: 'resumed', conceptId: 'c' })).toBe(true)
    expect(shouldChain({ kind: 'finalized' })).toBe(false)
    expect(shouldChain({ kind: 'noop', reason: 'x' })).toBe(false)
    expect(shouldChain({ kind: 'failed', error: 'x' })).toBe(false)
  })
})
