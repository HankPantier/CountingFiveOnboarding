import { describe, expect, it } from 'vitest'
import { summarizeEditRun } from './edit-run-summary'

describe('summarizeEditRun', () => {
  it('counts every successful commit tool as applied', () => {
    const parts = [
      { type: 'text' },
      { type: 'tool-apply_edit', output: { success: true, replacements: 3 } },
      { type: 'tool-apply_edit', output: { success: true, replacements: 1 } },
      { type: 'tool-set_faq', output: { success: true, count: 4 } },
    ]
    expect(summarizeEditRun(parts, 'stop')).toEqual({ applied: 3, failed: 0, incomplete: false })
  })

  it('counts tool outputs carrying an error as failed', () => {
    const parts = [
      { type: 'tool-apply_edit', output: { success: true } },
      { type: 'tool-apply_edit', output: { error: 'No unique match for that snippet.' } },
    ]
    expect(summarizeEditRun(parts, 'stop')).toEqual({ applied: 1, failed: 1, incomplete: false })
  })

  it('marks the run incomplete when it stopped on the step cap (tool-calls)', () => {
    const parts = [{ type: 'tool-apply_edit', output: { success: true } }]
    expect(summarizeEditRun(parts, 'tool-calls')).toEqual({ applied: 1, failed: 0, incomplete: true })
  })

  it('ignores non-commit parts and tolerates the legacy `result` field', () => {
    const parts = [
      { type: 'tool-suggest_mbp_update', output: { success: true } },
      { type: 'tool-apply_edit', result: { success: true } },
    ]
    expect(summarizeEditRun(parts, 'stop')).toEqual({ applied: 1, failed: 0, incomplete: false })
  })

  it('returns all-zero for a turn with no tool calls (agent only asked a question)', () => {
    expect(summarizeEditRun([{ type: 'text' }], 'stop')).toEqual({ applied: 0, failed: 0, incomplete: false })
    expect(summarizeEditRun(undefined)).toEqual({ applied: 0, failed: 0, incomplete: false })
  })

  it('counts remove_text as one applied commit and surfaces a per-phrase details breakdown', () => {
    const parts = [
      {
        type: 'tool-remove_text',
        output: {
          success: true,
          applied: [
            { find: '40 years', removed: 3 },
            { find: 'Root Advisors', removed: 4 },
            { find: 'Nowhere Inc', removed: 0 },
          ],
          dashesStripped: 6,
          residual: [{ find: 'Jared Hammack, CPA', remaining: 1 }],
          firmWide: [{ find: 'Root Advisors', source: 'firm profile', remaining: 2 }],
        },
      },
    ]
    expect(summarizeEditRun(parts, 'stop')).toEqual({
      applied: 1,
      failed: 0,
      incomplete: false,
      details: {
        removed: [
          { find: '40 years', removed: 3 },
          { find: 'Root Advisors', removed: 4 },
          { find: 'Nowhere Inc', removed: 0 },
        ],
        dashesStripped: 6,
        residual: [{ find: 'Jared Hammack, CPA', remaining: 1 }],
        firmWide: [{ find: 'Root Advisors', source: 'firm profile', remaining: 2 }],
      },
    })
  })

  it('sums removed counts per phrase across multiple remove_text calls', () => {
    const parts = [
      { type: 'tool-remove_text', output: { success: true, applied: [{ find: 'X', removed: 2 }], dashesStripped: 1, residual: [], firmWide: [] } },
      { type: 'tool-remove_text', output: { success: true, applied: [{ find: 'X', removed: 3 }], dashesStripped: 4, residual: [], firmWide: [] } },
    ]
    const summary = summarizeEditRun(parts, 'stop')
    expect(summary.applied).toBe(2)
    expect(summary.details).toEqual({ removed: [{ find: 'X', removed: 5 }], dashesStripped: 5, residual: [], firmWide: [] })
  })

  it('counts a failed remove_text as failed and adds no details', () => {
    const parts = [{ type: 'tool-remove_text', output: { error: 'That edit would break a block annotation: ...' } }]
    expect(summarizeEditRun(parts, 'stop')).toEqual({ applied: 0, failed: 1, incomplete: false })
  })
})
