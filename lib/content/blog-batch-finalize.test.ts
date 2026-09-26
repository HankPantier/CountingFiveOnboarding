import { describe, expect, it } from 'vitest'
import { settledBatchStatus, finalizeBlogBatchIfDone } from './blog-batch-runner'

describe('settledBatchStatus', () => {
  it('stays open while any target is pending or generating', () => {
    expect(settledBatchStatus(['complete', 'generating'])).toBeNull()
    expect(settledBatchStatus(['pending'])).toBeNull()
  })
  it('is complete when any target completed', () => {
    expect(settledBatchStatus(['complete', 'error'])).toBe('complete')
  })
  it('is error only when every target failed', () => {
    expect(settledBatchStatus(['error', 'error'])).toBe('error')
  })
})

// Stand-in for the two queries finalizeBlogBatchIfDone makes.
function stub(targetStatuses: string[]) {
  const batchUpdates: Array<{ values: Record<string, unknown>; filters: Array<[string, string, unknown]> }> = []
  const from = (table: string) => {
    const state: { values: Record<string, unknown> | null; filters: Array<[string, string, unknown]> } = {
      values: null,
      filters: [],
    }
    const api = {
      select: () => api,
      update: (values: Record<string, unknown>) => { state.values = values; return api },
      eq: (c: string, v: unknown) => { state.filters.push(['eq', c, v]); return api },
      neq: (c: string, v: unknown) => { state.filters.push(['neq', c, v]); return api },
      then: (resolve: (v: unknown) => unknown) => {
        if (table === 'blog_batches' && state.values) batchUpdates.push({ values: state.values, filters: state.filters })
        return Promise.resolve(
          resolve({ data: table === 'blog_batch_targets' ? targetStatuses.map((status) => ({ status })) : null, error: null })
        )
      },
    }
    return api
  }
  return { supabase: { from } as unknown as Parameters<typeof finalizeBlogBatchIfDone>[0], batchUpdates }
}

describe('finalizeBlogBatchIfDone', () => {
  it('settles a batch the sweep just finished off (its last target swept to complete)', async () => {
    const { supabase, batchUpdates } = stub(['complete', 'complete', 'error'])
    await expect(finalizeBlogBatchIfDone(supabase, 'batch-1')).resolves.toBe('complete')
    expect(batchUpdates).toHaveLength(1)
    expect(batchUpdates[0].values.status).toBe('complete')
    expect(batchUpdates[0].filters).toContainEqual(['eq', 'id', 'batch-1'])
  })

  it('leaves a batch with live targets alone', async () => {
    const { supabase, batchUpdates } = stub(['complete', 'generating'])
    await expect(finalizeBlogBatchIfDone(supabase, 'batch-1')).resolves.toBeNull()
    expect(batchUpdates).toHaveLength(0)
  })
})
