import { describe, it, expect } from 'vitest'
import { asJson } from '@/lib/supabase/json-typed'
import { CID, RID, SID, makeConceptRow, makeRunRow } from './__fixtures__/rows'
import { VALID } from './__fixtures__/valid-bundle'
import { parseRenderMetrics, type RenderMetrics } from './metrics'
import { newReview, unmeasuredViewportWarning } from './review'
import { runScreenshotPaths, toConceptDto, toRunDto } from './run-dto'

const asJsonMetrics = (v: unknown): RenderMetrics => {
  const m = parseRenderMetrics(v)
  if (!m) throw new Error('fixture metrics')
  return m
}

const CUR = { viewport: 'desktop', path: `design/${SID}/runs/${RID}/current-desktop-aaaaaaaa.webp`, width: 1440, height: 900 }
const SHOT = { viewport: 'mobile', path: `design/${SID}/runs/${RID}/concept-0-mobile-bbbbbbbb.webp`, width: 780, height: 1568 }
const RUN = makeRunRow({
  status: 'refining',
  stage: 'render',
  cost_usd: 0.9,
  base_snapshot: asJson({ pagePath: '/services', themeShas: {}, screenshots: [CUR], notes: ['Input skipped — X: archived'] }),
})
const CONCEPTS = [
  makeConceptRow({ status: 'ready', screenshots: asJson([SHOT]) }),
  makeConceptRow({ id: 'c2', position: 1, status: 'rejected', bundle: null, error: 'palette.primary: bad' }),
]

describe('run DTO', () => {
  it('collects every screenshot path to sign', () => {
    expect(runScreenshotPaths(RUN, CONCEPTS)).toEqual([CUR.path, SHOT.path])
  })

  it('maps the run, its notes, current shots and concepts', () => {
    const dto = toRunDto(RUN, CONCEPTS, { [CUR.path]: 'https://signed/cur', [SHOT.path]: 'https://signed/shot' })
    expect(dto).toMatchObject({
      id: RID,
      status: 'refining',
      stage: 'render',
      paletteFreedom: 'evolve',
      pagePath: '/services',
      costUsd: 0.9,
      costCapUsd: 4,
      notes: ['Input skipped — X: archived'],
      currentScreenshots: [{ viewport: 'desktop', url: 'https://signed/cur', width: 1440, height: 900 }],
    })
    expect(dto.capabilities.level).toBe(1)
    expect(dto.concepts[0]).toMatchObject({
      id: CID,
      name: 'Harbor Ledger',
      tagline: VALID.tagline,
      palette: VALID.palette,
      tokens: { roundness: 'soft', density: 'balanced', visualFeel: 'editorial' },
      screenshots: [{ viewport: 'mobile', url: 'https://signed/shot', width: 780, height: 1568 }],
    })
    expect(dto.concepts[1]).toMatchObject({ name: 'Concept 2', status: 'rejected', palette: null, error: 'palette.primary: bad' })
  })

  it('fontsNote: a non-blocking note when the concept’s render was captured before its webfonts loaded', () => {
    expect(toRunDto(RUN, CONCEPTS, {}).concepts[0].fontsNote).toBeNull()
    const late = makeConceptRow({ status: 'ready', screenshots: asJson([{ ...SHOT, fontsReady: false }]) })
    const dto = toConceptDto(late, { [SHOT.path]: 'https://signed/shot' })
    expect(dto.fontsNote).toBe('Fonts hadn’t finished loading when this was captured — the mobile screenshot may show fallback fonts.')
    // The screenshot itself still renders (signed, no flag leaks into the DTO shot).
    expect(dto.screenshots).toEqual([{ viewport: 'mobile', url: 'https://signed/shot', width: 780, height: 1568 }])
    // A render-gate-free note: no warning or failure is added.
    expect(dto.review).toBeNull()
  })

  it('drops screenshots whose signing failed', () => {
    expect(toRunDto(RUN, CONCEPTS, {}).currentScreenshots).toEqual([])
  })
})

describe('critique-loop DTO', () => {
  const INIT = { viewport: 'desktop', path: `design/${SID}/runs/${RID}/concept-0-r0-desktop.webp`, width: 1440, height: 900 }
  const LATEST = { viewport: 'desktop', path: `design/${SID}/runs/${RID}/concept-0-r2-desktop.webp`, width: 1440, height: 900 }
  const OVERFLOW = { v: 1, viewports: [{ viewport: 'mobile', textChecked: 1, textUnverified: 0, contrast: [], overflow: { scrollWidth: 430, viewportWidth: 390, offenders: [] }, hidden: [] }] }
  const row = makeConceptRow({
    status: 'refining',
    iterations: 2,
    screenshots: asJson([LATEST]),
    critique: asJson({ ...newReview(), next: 'critique', claim: { unit: 'critique', at: '2026-09-25T12:00:00.000Z' }, metrics: OVERFLOW, metricsIteration: 2, initialScreenshots: [INIT], notes: ['n'] }),
  })
  const signed = { [INIT.path]: 'https://signed/init', [LATEST.path]: 'https://signed/latest' }

  it('revisionsUsed survives a best-iteration fallback (iterations rewound to the kept version)', () => {
    const kept = makeConceptRow({ status: 'ready', iterations: 1, critique: asJson({ ...newReview(), next: 'done', revisionsUsed: 2 }) })
    expect(toConceptDto(kept, {})).toMatchObject({ iterations: 1, revisionsUsed: 2 })
  })
  it('derives revisionsUsed for a review written before the counter (highest recorded iteration)', () => {
    const crit2 = {
      iteration: 2,
      scores: { brandFit: 3, distinctiveness: 3, hierarchy: 3, legibility: 3, consistency: 3, craft: 3 },
      reasons: { brandFit: '', distinctiveness: '', hierarchy: '', legibility: '', consistency: '', craft: '' },
      issues: [],
      summary: '',
      passed: false,
      mean: 3,
      model: 'claude-opus-5-5',
      paletteFreedom: 'free',
      at: '2026-09-25T12:00:00.000Z',
    }
    const legacy = makeConceptRow({ status: 'ready', iterations: 1, critique: asJson({ ...newReview(), next: 'done', critiques: [crit2] }) })
    expect(toConceptDto(legacy, {}).revisionsUsed).toBe(2)
    expect(toConceptDto(makeConceptRow({ status: 'ready', iterations: 0 }), {}).revisionsUsed).toBe(0)
  })

  it('carries the review: active unit, measured, baseline-diffed gate failures, signed first-render shots', () => {
    const dto = toConceptDto(row, signed)
    expect(dto.iterations).toBe(2)
    expect(dto.review).toMatchObject({ next: 'critique', activeUnit: 'critique', measured: true, latest: null, critiqueCount: 0, outcome: null, notes: ['n'] })
    expect(dto.review?.gateFailures[0]).toContain('wider than the screen')
    expect(dto.review?.initialScreenshots).toEqual([{ viewport: 'desktop', url: 'https://signed/init', width: 1440, height: 900 }])
    expect(toConceptDto(row, signed, asJsonMetrics(OVERFLOW)).review?.gateFailures).toEqual([])
  })
  it('a partly-measured render (mobile failed) reports the unmeasured viewport and the apply warning, not a clean pass', () => {
    const DESKTOP_ONLY = { v: 1, viewports: [{ viewport: 'desktop', textChecked: 1, textUnverified: 0, contrast: [], overflow: null, hidden: [] }] }
    const partial = makeConceptRow({ status: 'ready', critique: asJson({ ...newReview(), next: 'done', metrics: DESKTOP_ONLY, metricsIteration: 0 }) })
    const review = toConceptDto(partial, {}).review
    expect(review).toMatchObject({ measured: true, unmeasuredViewports: ['mobile'], gateFailures: [], renderWarnings: [unmeasuredViewportWarning('mobile')] })
    // Fully measured ⇒ nothing to warn about; unmeasured ⇒ the UI's "render checks not run".
    expect(toConceptDto(row, signed, asJsonMetrics(OVERFLOW)).review).toMatchObject({ unmeasuredViewports: ['desktop'] })
    expect(toConceptDto(makeConceptRow({ critique: asJson(newReview()) }), {}).review).toMatchObject({ measured: false, unmeasuredViewports: [], renderWarnings: [] })
  })
  it('a P3 concept (no review) has review null', () => {
    expect(toConceptDto(makeConceptRow({ critique: null }), {}).review).toBeNull()
  })
  it('signs the first-render screenshots too, and the run DTO carries maxRevisions', () => {
    const run = makeRunRow({ max_revisions: 2 })
    expect(runScreenshotPaths(run, [row])).toEqual([LATEST.path, INIT.path])
    expect(toRunDto(run, [row], signed).maxRevisions).toBe(2)
  })
})

describe('toRunDto — stalled', () => {
  const T = '2026-09-26T23:25:00.000Z'
  const t = Date.parse(T)
  const inLoop = makeConceptRow({ status: 'refining', updated_at: T, critique: asJson({ ...newReview(), next: 'revise' }) })
  it('is true for an active run whose chain marker is current, false once a later write lands', () => {
    const run = makeRunRow({ status: 'refining', updated_at: T, base_snapshot: asJson({ pagePath: '/', themeShas: {}, screenshots: [], notes: [], chainStalledAt: T }) })
    expect(toRunDto(run, [inLoop], {}, t + 1000).stalled).toBe(true)
    expect(toRunDto(run, [{ ...inLoop, updated_at: new Date(t + 500).toISOString() }], {}, t + 1000).stalled).toBe(false)
  })
  it('is false while a unit holds its claim, and for a finished run', () => {
    const claimed = { ...inLoop, critique: asJson({ ...newReview(), next: 'revise', claim: { unit: 'revise', at: T } }) }
    expect(toRunDto(makeRunRow({ status: 'refining', updated_at: T }), [claimed], {}, t + 3_600_000).stalled).toBe(false)
    expect(toRunDto(makeRunRow({ status: 'ready', updated_at: T }), [], {}, t + 3_600_000).stalled).toBe(false)
  })
})
