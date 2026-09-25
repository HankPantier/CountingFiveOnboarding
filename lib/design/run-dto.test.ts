import { describe, it, expect } from 'vitest'
import { asJson } from '@/lib/supabase/json-typed'
import { CID, RID, SID, makeConceptRow, makeRunRow } from './__fixtures__/rows'
import { VALID } from './__fixtures__/valid-bundle'
import { parseRenderMetrics, type RenderMetrics } from './metrics'
import { newReview } from './review'
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

  it('carries the review: active unit, measured, baseline-diffed gate failures, signed first-render shots', () => {
    const dto = toConceptDto(row, signed)
    expect(dto.iterations).toBe(2)
    expect(dto.review).toMatchObject({ next: 'critique', activeUnit: 'critique', measured: true, latest: null, critiqueCount: 0, outcome: null, notes: ['n'] })
    expect(dto.review?.gateFailures[0]).toContain('wider than the screen')
    expect(dto.review?.initialScreenshots).toEqual([{ viewport: 'desktop', url: 'https://signed/init', width: 1440, height: 900 }])
    expect(toConceptDto(row, signed, asJsonMetrics(OVERFLOW)).review?.gateFailures).toEqual([])
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
