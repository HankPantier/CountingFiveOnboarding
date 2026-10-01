import { describe, it, expect, vi } from 'vitest'

type Call = { table: string; ops: Array<[string, ...unknown[]]> }
const calls: Call[] = []
const rows: Record<string, unknown[]> = {}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const b: Record<string, unknown> = {}
      for (const op of ['select', 'not', 'or', 'in', 'eq']) {
        b[op] = (...args: unknown[]) => { call.ops.push([op, ...args]); return b }
      }
      b.then = (ok: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows[table] ?? [], error: null }).then(ok)
      return b
    },
  }),
}))

import { loadContentQuality } from './_data'

const critic = {
  evidence_specificity: 8, information_gain: 8, brand_fidelity: 8, promise_fulfillment: 8,
  unsupported_claims: [], notes: 'ok', critic_model: 'm', scored_at: '2026-10-01T00:00:00Z',
}
const qa = {
  mode: 'on', ran_at: '2026-10-01T00:00:00Z', findings: [],
  scores: { accuracy: 6, copy: 10, seo: 10, structure: 10 }, judge: null, passed: false,
}

describe('loadContentQuality', () => {
  it('includes judge-less QA reviews in QA stats without counting them as critic scores', async () => {
    rows.generated_pages = [
      { critic_review: critic, qa_review: null, page_url: '/a', content_job_id: 'j1' },
      { critic_review: null, qa_review: qa, page_url: '/b', content_job_id: 'j1' },
    ]
    const data = await loadContentQuality()
    const pagesCall = calls.find(c => c.table === 'generated_pages')!
    expect(pagesCall.ops).toContainEqual(['or', 'critic_review.not.is.null,qa_review.not.is.null'])
    expect(pagesCall.ops.some(([op]) => op === 'not')).toBe(false)
    expect(data.qa.pages).toBe(1)
    expect(data.slices[0].scored).toBe(1)
    expect(data.totalScored).toBe(1)
  })
})
