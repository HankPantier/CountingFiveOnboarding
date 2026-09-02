import { beforeEach, describe, expect, it, vi } from 'vitest'

// `rows` backs getArticleImportStatus; `updates` captures writes.
const h = vi.hoisted(() => ({
  rows: [] as Array<{ status: string; error?: string | null }>,
  reset: [] as Array<{ id: string }>,
}))

vi.mock('@/lib/supabase/server', () => {
  function builder() {
    const state = { op: 'select' as 'select' | 'update' }
    const api = {
      select: () => api,
      update: () => {
        state.op = 'update'
        return api
      },
      eq: () => api,
      in: () => api,
      then: (resolve: (v: { data: unknown; error: null }) => void) => {
        if (state.op === 'update') return resolve({ data: h.reset, error: null })
        return resolve({ data: h.rows, error: null })
      },
    }
    return api
  }
  return { createServerClient: () => ({ from: () => builder() }) }
})

vi.mock('./article-import-generator', () => ({ importArticleAsIs: vi.fn(async () => ({ status: 'complete' })) }))

import { getArticleImportStatus, resetFailedArticleImports } from './article-import-inclusion'

beforeEach(() => {
  h.rows = []
  h.reset = []
})

describe('getArticleImportStatus — the publish/completion gate', () => {
  it('is terminal when there are no imports', async () => {
    const s = await getArticleImportStatus('job-1')
    expect(s).toMatchObject({ total: 0, terminal: true })
  })

  it('is non-terminal while any import is pending or drafting', async () => {
    h.rows = [{ status: 'complete' }, { status: 'drafting' }, { status: 'pending' }]
    const s = await getArticleImportStatus('job-1')
    expect(s).toMatchObject({ total: 3, complete: 1, drafting: 1, pending: 1, terminal: false })
  })

  it('is terminal when everything is complete or errored, and dedupes error samples', async () => {
    h.rows = [
      { status: 'complete' },
      { status: 'error', error: 'API usage limit reached' },
      { status: 'error', error: 'API usage limit reached' },
    ]
    const s = await getArticleImportStatus('job-1')
    expect(s.terminal).toBe(true)
    expect(s.error).toBe(2)
    expect(s.errorSamples).toEqual(['API usage limit reached'])
  })
})

describe('resetFailedArticleImports', () => {
  it('returns how many error rows it reset', async () => {
    h.reset = [{ id: 'a' }, { id: 'b' }]
    expect(await resetFailedArticleImports('job-1')).toBe(2)
  })
})
