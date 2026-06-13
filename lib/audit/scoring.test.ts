import { describe, expect, it } from 'vitest'
import type { CategoryScores } from './types'
import { computeOverall, getGrade, pyRound, scoreCategory } from './scoring'

describe('pyRound (Python round-half-to-even parity)', () => {
  it('rounds halves to even, not up', () => {
    expect(pyRound(0.5)).toBe(0)
    expect(pyRound(1.5)).toBe(2)
    expect(pyRound(2.5)).toBe(2)
    expect(pyRound(12.5)).toBe(12)
    expect(pyRound(13.5)).toBe(14)
  })

  it('rounds non-halves normally', () => {
    expect(pyRound(77.77)).toBe(78)
    expect(pyRound(55.125)).toBe(55)
    expect(pyRound(23.4)).toBe(23)
  })

  it('rounds to N digits', () => {
    expect(pyRound(2.0, 1)).toBe(2)
    expect(pyRound(13.94, 1)).toBe(13.9)
    expect(pyRound(2.05, 1)).toBe(2.0) // half-to-even at the tenths place
  })
})

describe('getGrade (audit.py GRADE_SCALE)', () => {
  it('maps scores to letters at the right thresholds', () => {
    expect(getGrade(100)).toBe('A')
    expect(getGrade(90)).toBe('A')
    expect(getGrade(89)).toBe('B')
    expect(getGrade(80)).toBe('B')
    expect(getGrade(70)).toBe('C')
    expect(getGrade(60)).toBe('D')
    expect(getGrade(59)).toBe('F')
    expect(getGrade(0)).toBe('F')
  })
})

describe('scoreCategory (weighted pass ratio)', () => {
  it('returns 100 when no checks', () => {
    expect(scoreCategory([])).toBe(100)
  })

  it('returns the rounded weighted pass percentage', () => {
    // All passed → 100
    expect(
      scoreCategory([
        [true, 2],
        [true, 1],
      ]),
    ).toBe(100)
    // None passed → 0
    expect(
      scoreCategory([
        [false, 2],
        [false, 1],
      ]),
    ).toBe(0)
  })

  it("reproduces the sample's indexability score (3.5 / 4.5 → 78)", () => {
    // sitemap_found(2.0)=pass, sitemap_in_robots(1.0)=fail, !noindex(1.5)=pass
    expect(
      scoreCategory([
        [true, 2.0],
        [false, 1.0],
        [true, 1.5],
      ]),
    ).toBe(78)
  })
})

describe('computeOverall — parity with the stgcpas sample', () => {
  // Stored scores from raw-docs/site-audit/reference/audit-stgcpas-com-2026-04-20.json
  const sampleScores: CategoryScores = {
    technical: 55,
    performance: null, // PSI was unavailable at capture
    onpage_seo: 23,
    content: 47,
    indexability: 78,
    schema: 75,
    ai_llm: 64,
    ux: 92,
    analytics: 0,
  }

  it('reproduces overall_score 55 (performance excluded as null)', () => {
    expect(computeOverall(sampleScores)).toBe(55)
  })

  it('reproduces overall_grade F', () => {
    expect(getGrade(computeOverall(sampleScores))).toBe('F')
  })

  it('returns 0 when every category is null', () => {
    const allNull = Object.fromEntries(
      Object.keys(sampleScores).map((k) => [k, null]),
    ) as CategoryScores
    expect(computeOverall(allNull)).toBe(0)
  })
})
