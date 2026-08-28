import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rows: [] as Array<{ status: string }> }))

// getLibrarySelectionStatus issues one read:
//   from('content_job_library_selections').select('status').eq('content_job_id', id)
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({ data: h.rows }),
      }),
    }),
  }),
}))

import { getLibrarySelectionStatus } from './library-inclusion'

beforeEach(() => {
  h.rows = []
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
