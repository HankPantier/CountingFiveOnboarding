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
})
