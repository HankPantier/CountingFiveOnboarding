import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CID, IID, RID, SID, makeConceptRow, makeInputRow, makeRunRow } from './__fixtures__/rows'
import { BRAND_TEXT, DESIGN_TEXT, THEME_CSS_TEXT } from './__fixtures__/theme-texts'
import { VALID } from './__fixtures__/valid-bundle'

const m = vi.hoisted(() => ({
  getRun: vi.fn(),
  listConcepts: vi.fn(),
  transitionRun: vi.fn(),
  updateRunFields: vi.fn(async (..._a: unknown[]) => {}),
  deleteRunConcepts: vi.fn(async (..._a: unknown[]) => {}),
  insertConcepts: vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
  claimConceptRender: vi.fn(),
  finishConceptRender: vi.fn(async (..._a: unknown[]) => null),
  snapshot: vi.fn(),
  listInputs: vi.fn(),
  readSessionSchema: vi.fn(),
  download: vi.fn(),
  loadShell: vi.fn(),
  renderFolds: vi.fn(),
  generateConcepts: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('./run-store', () => ({
  getRun: (...a: unknown[]) => m.getRun(...a),
  listConcepts: (...a: unknown[]) => m.listConcepts(...a),
  transitionRun: (...a: unknown[]) => m.transitionRun(...a),
  updateRunFields: (...a: unknown[]) => m.updateRunFields(...a),
  deleteRunConcepts: (...a: unknown[]) => m.deleteRunConcepts(...a),
  insertConcepts: (...a: unknown[]) => m.insertConcepts(...a),
  claimConceptRender: (...a: unknown[]) => m.claimConceptRender(...a),
  finishConceptRender: (...a: unknown[]) => m.finishConceptRender(...a),
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
vi.mock('./concept-generator', () => ({ generateConcepts: (a: unknown) => m.generateConcepts(a) }))
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
  m.generateConcepts.mockResolvedValue({
    concepts: [
      { bundle: VALID, files: FILES, notes: [] },
      { bundle: { ...VALID, name: 'Oxblood Ledger' }, files: FILES, notes: [] },
    ],
    rejected: [{ errors: ['palette.primary: must be a #rrggbb hex colour'] }],
    costUsd: 0.5,
    notes: ['model note'],
    stoppedReason: null,
  })
})

describe('runDesignStep — generate', () => {
  beforeEach(() => {
    m.getRun.mockResolvedValueOnce(makeRunRow({ status: 'queued', input_ids: [IID] })).mockResolvedValueOnce(makeRunRow({ status: 'generating' }))
    m.listConcepts.mockResolvedValue([])
  })

  it('claims the run, generates, stores concepts (valid first, then rejected) and moves to render', async () => {
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'generated', concepts: 2 })
    expect(m.transitionRun.mock.calls[0].slice(1, 4)).toEqual([RID, ['queued'], { status: 'generating', stage: 'generate', error: null }])
    expect(m.deleteRunConcepts).toHaveBeenCalledWith({}, RID)

    const promptArg = m.generateConcepts.mock.calls[0][0] as { prompt: { parts: { type: string }[] }; costSoFarUsd: number; conceptCount: number }
    expect(promptArg.prompt.parts.some((p) => p.type === 'image')).toBe(true) // the current-site render
    expect(promptArg.conceptCount).toBe(3)

    const rows = m.insertConcepts.mock.calls[0][1] as { position: number; status: string; bundle: unknown; error: string | null }[]
    expect(rows.map((r) => [r.position, r.status])).toEqual([[0, 'pending'], [1, 'pending'], [2, 'rejected']])
    expect(rows[2].bundle).toBeNull()
    expect(rows[2].error).toContain('palette.primary')

    const last = m.transitionRun.mock.calls.at(-1) as unknown[]
    expect(last.slice(1, 3)).toEqual([RID, ['generating']])
    expect(last[3]).toMatchObject({ status: 'refining', stage: 'render', costUsd: 0.5 })
    const base = (last[3] as { baseSnapshot: { screenshots: unknown[]; notes: string[] } }).baseSnapshot
    expect(base.screenshots).toEqual([CURRENT_SHOT])
    expect(base.notes).toContain('model note')
    expect(base.notes).toContain('Input skipped — Acme CPA: it has not been captured yet')
  })

  it('is a no-op when another worker already claimed generation', async () => {
    m.transitionRun.mockResolvedValueOnce(null)
    expect(await runDesignStep(CTX)).toEqual({ kind: 'noop', reason: 'generation already claimed' })
    expect(m.generateConcepts).not.toHaveBeenCalled()
  })

  it('stops before the model call when the run was cancelled meanwhile', async () => {
    m.getRun.mockReset()
    m.getRun.mockResolvedValueOnce(makeRunRow({ status: 'queued' })).mockResolvedValueOnce(makeRunRow({ status: 'cancelled' }))
    expect((await runDesignStep(CTX)).kind).toBe('noop')
    expect(m.generateConcepts).not.toHaveBeenCalled()
  })

  it('fails the run with a cost-cap message when no concept survived', async () => {
    m.generateConcepts.mockResolvedValue({ concepts: [], rejected: [], costUsd: 0, notes: [], stoppedReason: 'cost_cap' })
    const out = await runDesignStep(CTX)
    expect(out.kind).toBe('failed')
    const last = m.transitionRun.mock.calls.at(-1) as unknown[]
    expect(last[3]).toMatchObject({ status: 'error' })
    expect((last[3] as { error: string }).error).toContain('cost cap')
    expect(m.insertConcepts).not.toHaveBeenCalled()
  })

  it('still records the cost when the run is cancelled during generation', async () => {
    m.transitionRun
      .mockImplementationOnce(async () => makeRunRow({ status: 'generating' }))
      .mockImplementationOnce(async () => null)
    expect((await runDesignStep(CTX)).kind).toBe('noop')
    expect(m.updateRunFields).toHaveBeenCalledWith({}, RID, { costUsd: 0.5 })
  })

  it('persists the spend and fails with our own message when a write after generation throws', async () => {
    m.transitionRun.mockImplementationOnce(async () => makeRunRow({ status: 'generating', input_ids: [IID], cost_usd: 0.25 }))
    m.insertConcepts.mockRejectedValueOnce(new Error('insertConcepts: duplicate key value violates unique constraint'))
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'failed', error: 'Concept generation failed — press Retry.' })
    const last = m.transitionRun.mock.calls.at(-1) as unknown[]
    expect(last.slice(1, 3)).toEqual([RID, ['generating']])
    expect(last[3]).toEqual({ status: 'error', error: 'Concept generation failed — press Retry.', costUsd: 0.75 })
  })

  it('still persists the spend when the failing run was cancelled meanwhile', async () => {
    m.transitionRun
      .mockImplementationOnce(async () => makeRunRow({ status: 'generating', input_ids: [IID], cost_usd: 0.25 }))
      .mockImplementationOnce(async () => null)
    m.insertConcepts.mockRejectedValueOnce(new Error('db down'))
    expect((await runDesignStep(CTX)).kind).toBe('failed')
    expect(m.updateRunFields).toHaveBeenCalledWith({}, RID, { costUsd: 0.75 })
  })

  it('does not touch cost when generation throws before reporting any spend', async () => {
    m.generateConcepts.mockRejectedValueOnce(new Error('boom'))
    expect((await runDesignStep(CTX)).kind).toBe('failed')
    const last = m.transitionRun.mock.calls.at(-1) as unknown[]
    expect(last[3]).toEqual({ status: 'error', error: 'Concept generation failed — press Retry.' })
    expect(m.updateRunFields).not.toHaveBeenCalled()
  })

  it('persists the reported spend when generation throws after a model call was accounted', async () => {
    m.transitionRun.mockImplementationOnce(async () => makeRunRow({ status: 'generating', input_ids: [IID], cost_usd: 0.25 }))
    m.generateConcepts.mockImplementationOnce(async (a: { onSpend?: (usd: number) => void }) => {
      a.onSpend?.(0.6)
      throw new Error('validateConceptBundle: unexpected token')
    })
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'failed', error: 'Concept generation failed — press Retry.' })
    const last = m.transitionRun.mock.calls.at(-1) as unknown[]
    expect(last.slice(1, 3)).toEqual([RID, ['generating']])
    expect(last[3]).toEqual({ status: 'error', error: 'Concept generation failed — press Retry.', costUsd: 0.85 })
  })

  it('persists the reported spend unguarded when the throwing run was cancelled meanwhile', async () => {
    m.transitionRun
      .mockImplementationOnce(async () => makeRunRow({ status: 'generating', input_ids: [IID], cost_usd: 0.25 }))
      .mockImplementationOnce(async () => null)
    m.generateConcepts.mockImplementationOnce(async (a: { onSpend?: (usd: number) => void }) => {
      a.onSpend?.(0.3)
      a.onSpend?.(0.6)
      throw new Error('boom')
    })
    expect((await runDesignStep(CTX)).kind).toBe('failed')
    expect(m.updateRunFields).toHaveBeenCalledWith({}, RID, { costUsd: 0.85 })
  })

  it('fails without a model call when the site has no design.json', async () => {
    m.snapshot.mockResolvedValue({ shas: {}, texts: { 'content/brand.json': BRAND_TEXT } })
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'failed', error: 'This site has no brand.json / design.json yet.' })
    expect(m.generateConcepts).not.toHaveBeenCalled()
  })

  it('reads content/design.md through the shared optional-file reader', async () => {
    m.readFile.mockResolvedValue({ content: '# Design notes', sha: 'd'.repeat(40) })
    await runDesignStep(CTX)
    expect(m.readFile).toHaveBeenCalledWith('o/r', 'content/design.md', 'draft')
  })
})

describe('runDesignStep — render', () => {
  beforeEach(() => {
    m.getRun.mockResolvedValue(makeRunRow({ status: 'refining', stage: 'render' }))
    m.listConcepts.mockResolvedValueOnce([makeConceptRow({ status: 'pending' })]).mockResolvedValueOnce([makeConceptRow({ status: 'ready' })])
    m.claimConceptRender.mockResolvedValue(makeConceptRow({ status: 'refining' }))
  })

  it('renders one concept, stores its folds, and finalizes when none remain', async () => {
    const out = await runDesignStep(CTX)
    expect(out).toEqual({ kind: 'rendered', conceptId: CID, remaining: 0 })
    expect(m.claimConceptRender).toHaveBeenCalledWith({}, RID, CID)
    expect((m.renderFolds.mock.calls[0][0] as { name: string }).name).toBe('concept-0')
    expect(m.finishConceptRender).toHaveBeenCalledWith({}, CID, { screenshots: [CURRENT_SHOT], error: null })
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ['refining'], { status: 'ready', stage: 'ready' })
  })

  it('keeps the concept applicable (ready, error note) when its render fails', async () => {
    m.renderFolds.mockResolvedValue({ shots: [], desktopWebp: null, error: 'The render timed out.' })
    await runDesignStep(CTX)
    expect(m.finishConceptRender).toHaveBeenCalledWith({}, CID, { screenshots: [], error: 'The render timed out.' })
  })

  it('finishes the concept with an error note when the site lost its theme files', async () => {
    m.snapshot.mockResolvedValue({ shas: {}, texts: {} })
    await runDesignStep(CTX)
    expect(m.renderFolds).not.toHaveBeenCalled()
    expect(m.finishConceptRender).toHaveBeenCalledWith({}, CID, { screenshots: [], error: 'This site has no brand.json / design.json yet.' })
  })

  it('is a no-op when the concept was already claimed', async () => {
    m.claimConceptRender.mockResolvedValue(null)
    expect((await runDesignStep(CTX)).kind).toBe('noop')
    expect(m.renderFolds).not.toHaveBeenCalled()
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
  it.each([
    [{ kind: 'generated', concepts: 2 }, true],
    [{ kind: 'rendered', conceptId: 'c', remaining: 1 }, true],
    [{ kind: 'rendered', conceptId: 'c', remaining: 0 }, false],
    [{ kind: 'finalized' }, false],
    [{ kind: 'noop', reason: 'x' }, false],
    [{ kind: 'failed', error: 'x' }, false],
  ] as const)('%j → %s', (o, want) => expect(shouldChain(o)).toBe(want))
})
