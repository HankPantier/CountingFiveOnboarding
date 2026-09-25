import { describe, it, expect, vi, afterEach } from 'vitest'
import { fakeSupabase } from './__fixtures__/fake-supabase'
import { DESIGN_INPUT_STUCK_MS, DESIGN_RUN_STUCK_MS, sweepStuckDesignRows } from './sweep'

const NOW = Date.parse('2026-09-25T12:00:00.000Z')

afterEach(() => vi.restoreAllMocks())

describe('sweepStuckDesignRows', () => {
  it('errors stale pending captures, active runs and generating/refining concepts', async () => {
    const f = fakeSupabase({
      design_inputs: [{ data: [{ id: 'i1' }] }],
      design_runs: [{ data: [{ id: 'r1' }, { id: 'r2' }] }],
      design_concepts: [{ data: [] }],
    })
    expect(await sweepStuckDesignRows(f.client, NOW)).toEqual({ inputs: 1, runs: 2, concepts: 0 })

    const stamp = new Date(NOW).toISOString()
    expect(f.opsFor('design_inputs')).toEqual([
      ['update', { capture_status: 'error', capture_error: 'Capture timed out', updated_at: stamp }],
      ['eq', 'capture_status', 'pending'],
      ['lt', 'updated_at', new Date(NOW - DESIGN_INPUT_STUCK_MS).toISOString()],
      ['select', 'id'],
    ])
    expect(f.opsFor('design_runs')).toContainEqual(['in', 'status', ['queued', 'capturing', 'generating', 'refining']])
    expect(f.opsFor('design_runs')).toContainEqual(['lt', 'updated_at', new Date(NOW - DESIGN_RUN_STUCK_MS).toISOString()])
    expect(f.opsFor('design_concepts')).toContainEqual(['in', 'status', ['generating', 'refining']])
  })

  it('never throws: a failing query logs and counts 0', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = fakeSupabase({
      design_inputs: [{ error: { message: 'relation does not exist' } }],
      design_runs: [{ data: [{ id: 'r1' }] }],
      design_concepts: [],
    })
    expect(await sweepStuckDesignRows(f.client, NOW)).toEqual({ inputs: 0, runs: 1, concepts: 0 })
    expect(err).toHaveBeenCalledTimes(2)
  })
})
