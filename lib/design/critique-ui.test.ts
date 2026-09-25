import { describe, it, expect } from 'vitest'
import type { CritiqueRecord } from './critique'
import type { ConceptReviewDto, DesignConceptDto, DesignRunDto, ScreenshotDto } from './run-types'
import { beforeAfterShots, conceptStatusLabel, critiqueChip, refineStatusLabel, revisionsLabel, scoreRows } from './critique-ui'

const CRIT: CritiqueRecord = {
  iteration: 1,
  scores: { brandFit: 5, distinctiveness: 3, hierarchy: 4, legibility: 2, consistency: 4, craft: 4 },
  reasons: { brandFit: 'On voice', distinctiveness: 'Close to concept 2', hierarchy: '', legibility: 'Grey captions', consistency: '', craft: '' },
  issues: [],
  summary: '',
  passed: false,
  mean: 3.67,
  model: 'claude-opus-5-5',
  at: '2026-09-25T12:00:00.000Z',
}
const shot = (url: string): ScreenshotDto => ({ viewport: 'desktop', url, width: 1440, height: 900 })
const review = (over: Partial<ConceptReviewDto> = {}): ConceptReviewDto => ({
  next: 'done',
  activeUnit: null,
  latest: null,
  critiqueCount: 0,
  outcome: null,
  measured: true,
  gateFailures: [],
  notes: [],
  initialScreenshots: [],
  ...over,
})
const concept = (over: Partial<DesignConceptDto> = {}): DesignConceptDto =>
  ({ id: 'c', position: 0, status: 'ready', iterations: 0, review: null, screenshots: [], palette: { primary: '#000000' }, ...over }) as DesignConceptDto

describe('scoreRows', () => {
  it('six rows in rubric order; tone follows each dimension’s pass bar (distinctiveness needs 4)', () => {
    const rows = scoreRows(CRIT)
    expect(rows.map((r) => r.key)).toEqual(['brandFit', 'distinctiveness', 'hierarchy', 'legibility', 'consistency', 'craft'])
    expect(rows[0]).toMatchObject({ label: 'Brand fit', score: 5, pct: 100, tone: 'success', reason: 'On voice' })
    expect(rows[1]).toMatchObject({ score: 3, tone: 'error' }) // below the distinctiveness bar
    expect(rows[3]).toMatchObject({ score: 2, pct: 40, tone: 'error' })
    expect(rows[2].tone).toBe('success')
  })
})

describe('critiqueChip', () => {
  it('render-check failures win, then the rubric verdict, then how the loop ended', () => {
    expect(critiqueChip(null)).toBeNull()
    expect(critiqueChip(review({ gateFailures: ['a', 'b'], latest: { ...CRIT, passed: true } }))).toEqual({ label: 'Fails 2 render checks', tone: 'error' })
    expect(critiqueChip(review({ latest: { ...CRIT, passed: true, mean: 4.17 } }))).toEqual({ label: 'Passed review · 4.2', tone: 'success' })
    expect(critiqueChip(review({ latest: CRIT }))).toEqual({ label: 'Below the bar · 3.7', tone: 'warning' })
    expect(critiqueChip(review({ outcome: 'not_rendered' }))).toEqual({ label: 'Not rendered', tone: 'neutral' })
  })
})

describe('status labels', () => {
  it('a concept in its loop says which unit is running', () => {
    expect(conceptStatusLabel(concept({ status: 'refining', review: review({ next: 'critique', activeUnit: 'critique' }) }), 2)).toBe('Critiquing…')
    expect(conceptStatusLabel(concept({ status: 'refining', iterations: 1, review: review({ next: 'revise' }) }), 2)).toBe('Revising (round 2 of 2)…')
    expect(conceptStatusLabel(concept({ status: 'refining', iterations: 1, review: review({ next: 'render' }) }), 2)).toBe('Rendering revision 1…')
    expect(conceptStatusLabel(concept({ status: 'refining', review: null }), 2)).toBe('Rendering…')
    expect(conceptStatusLabel(concept({ status: 'pending' }), 2)).toBe('Waiting')
    expect(conceptStatusLabel(concept({ status: 'ready' }), 2)).toBe('Ready')
  })
  it('the run label names the concept and round', () => {
    const run = (c: DesignConceptDto): Pick<DesignRunDto, 'concepts' | 'maxRevisions'> => ({ concepts: [concept({ status: 'ready' }), c], maxRevisions: 2 })
    expect(refineStatusLabel(run(concept({ id: 'b', position: 1, status: 'refining', review: review({ next: 'critique' }) })))).toBe('Critiquing concept 2…')
    expect(refineStatusLabel(run(concept({ id: 'b', position: 1, status: 'refining', iterations: 0, review: review({ next: 'revise' }) })))).toBe(
      'Revising concept 2 (round 1 of 2)…'
    )
    expect(refineStatusLabel(run(concept({ id: 'b', position: 1, status: 'refining', review: null })))).toBe('Rendering concept 2…')
    expect(refineStatusLabel({ concepts: [concept()], maxRevisions: 2 })).toBeNull()
  })
  it('revisionsLabel', () => {
    expect(revisionsLabel(0, 2)).toBe('No revisions')
    expect(revisionsLabel(1, 2)).toBe('1 of 2 revisions')
  })
})

describe('beforeAfterShots', () => {
  it('pairs the first render with the latest once the concept was revised', () => {
    expect(beforeAfterShots(concept({ iterations: 0, screenshots: [shot('a')], review: review({ initialScreenshots: [shot('a')] }) }))).toBeNull()
    expect(beforeAfterShots(concept({ iterations: 1, screenshots: [], review: review({ initialScreenshots: [shot('a')] }) }))).toBeNull()
    expect(beforeAfterShots(concept({ iterations: 1, screenshots: [shot('b')], review: review({ initialScreenshots: [shot('a')] }) }))).toEqual({
      before: [shot('a')],
      after: [shot('b')],
    })
  })
})
