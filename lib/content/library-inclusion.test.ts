import { beforeEach, describe, expect, it, vi } from 'vitest'

// Shared fixture state. `rows` backs getLibrarySelectionStatus; `inFlight` /
// `selections` back the two reads in runLibrarySelectionsForJob; `updates`
// captures every .update() the code issues.
const h = vi.hoisted(() => ({
  rows: [] as Array<{ status: string }>,
  inFlight: [] as Array<Record<string, unknown>>,
  selections: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ payload: Record<string, unknown>; filters: Array<[string, unknown]> }>,
}))

// A minimal chainable query-builder that resolves reads from the fixtures and
// records writes. Routes the two distinct selects by their filters:
//   .eq('status','drafting')      → inFlight
//   .in('status',[...])           → selections
//   (getLibrarySelectionStatus)   → rows
vi.mock('@/lib/supabase/server', () => {
  function builder() {
    const state: {
      op: 'select' | 'update'
      payload: Record<string, unknown>
      filters: Array<[string, unknown]>
      inFilter: boolean
    } = { op: 'select', payload: {}, filters: [], inFilter: false }
    const api = {
      select: () => api,
      update: (payload: Record<string, unknown>) => {
        state.op = 'update'
        state.payload = payload
        return api
      },
      eq: (col: string, val: unknown) => {
        state.filters.push([col, val])
        return api
      },
      in: (col: string, vals: unknown) => {
        state.filters.push([col, vals])
        state.inFilter = true
        return api
      },
      then: (resolve: (v: { data: unknown; error: null }) => void) => {
        if (state.op === 'update') {
          h.updates.push({ payload: state.payload, filters: state.filters })
          return resolve({ data: null, error: null })
        }
        if (state.filters.some(([c, v]) => c === 'status' && v === 'drafting')) {
          return resolve({ data: h.inFlight, error: null })
        }
        if (state.inFilter) return resolve({ data: h.selections, error: null })
        return resolve({ data: h.rows, error: null })
      },
    }
    return api
  }
  return { createServerClient: () => ({ from: () => builder() }) }
})

const resolveEligibility = vi.fn()
vi.mock('./blog-batch-targets', () => ({
  resolveEligibility: (...args: unknown[]) => resolveEligibility(...args),
  insertBatchTargets: vi.fn(),
}))

import { getLibrarySelectionStatus, runLibrarySelectionsForJob } from './library-inclusion'

beforeEach(() => {
  h.rows = []
  h.inFlight = []
  h.selections = []
  h.updates = []
  resolveEligibility.mockReset()
})

describe('getLibrarySelectionStatus — the publish/completion gate', () => {
  it('is terminal with zero selections', async () => {
    const s = await getLibrarySelectionStatus('job-1')
    expect(s.total).toBe(0)
    expect(s.terminal).toBe(true)
  })

  it('is NOT terminal while any selection is pending or drafting', async () => {
    h.rows = [{ status: 'complete' }, { status: 'pending' }, { status: 'drafting' }]
    const s = await getLibrarySelectionStatus('job-1')
    expect(s).toMatchObject({ total: 3, pending: 1, drafting: 1, complete: 1, terminal: false })
  })

  it('is terminal once every selection is complete or error (a surfaced failure does not block forever)', async () => {
    h.rows = [{ status: 'complete' }, { status: 'complete' }, { status: 'error' }]
    const s = await getLibrarySelectionStatus('job-1')
    expect(s).toMatchObject({ complete: 2, error: 1, pending: 0, drafting: 0, terminal: true })
  })
})

describe('runLibrarySelectionsForJob — not-yet-provisioned repo', () => {
  it('resets error selections to pending (does not mark them failed) when the job is not eligible', async () => {
    h.selections = [
      { id: 's1', session_id: 'sess-1', batch_id: 'b1', resource_idea_id: null },
      { id: 's2', session_id: 'sess-1', batch_id: 'b2', resource_idea_id: null },
    ]
    resolveEligibility.mockResolvedValue({ eligible: [], ineligible: [{ sessionId: 'sess-1', contentJobId: 'job-1' }] })

    await runLibrarySelectionsForJob('job-1')

    // Exactly one bulk reset to pending, scoped to this job's error rows.
    expect(h.updates).toHaveLength(1)
    const u = h.updates[0]
    expect(u.payload).toMatchObject({ status: 'pending', error: null })
    expect(u.filters).toContainEqual(['content_job_id', 'job-1'])
    expect(u.filters).toContainEqual(['status', 'error'])
    // Never wrote an 'error' status (the old not-provisioned behavior).
    expect(h.updates.some((x) => x.payload.status === 'error')).toBe(false)
  })
})
