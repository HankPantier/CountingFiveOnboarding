import { describe, expect, it } from 'vitest'
import { computeOverall, computeScores, getGrade, type ComputeScoresInput } from './scoring'
import golden from './__fixtures__/scoring-golden.json'

// Golden regression guard. The fixture freezes a real ComputeScoresInput
// captured from a live run (see scripts/capture-audit-fixture.mts) plus the
// scores/findings it produced. Re-running computeScores on the frozen input
// must reproduce the frozen output exactly — any drift in scoring logic fails
// here. Deterministic, no network. Regenerate intentionally with the script.
describe('scoring golden fixture', () => {
  const input = golden.input as unknown as ComputeScoresInput

  it('reproduces the frozen scores', () => {
    const { scores } = computeScores(input)
    expect(scores).toEqual(golden.expected.scores)
  })

  it('reproduces the frozen findings', () => {
    const { findings } = computeScores(input)
    expect(findings).toEqual(golden.expected.findings)
  })

  it('reproduces the frozen overall score + grade', () => {
    const { scores } = computeScores(input)
    const overall = computeOverall(scores)
    expect(overall).toBe(golden.expected.overall_score)
    expect(getGrade(overall)).toBe(golden.expected.overall_grade)
  })
})
