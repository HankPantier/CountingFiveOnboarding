import { describe, it, expect } from 'vitest'
import { fenceQaForHumanEdit, QA_FENCED_STATUSES } from './fence'

type Call = { table: string; payload: unknown; filters: Array<[string, string, unknown]> }

// Recording fake: every filter on the update chain is captured in order.
function fake(result: { data: unknown; error: unknown }) {
  const calls: Call[] = []
  const supabase = {
    from(table: string) {
      return {
        update(payload: unknown) {
          const call: Call = { table, payload, filters: [] }
          calls.push(call)
          const chain = {
            eq: (c: string, v: unknown) => { call.filters.push(['eq', c, v]); return chain },
            in: (c: string, v: unknown) => { call.filters.push(['in', c, v]); return chain },
            select: () => Promise.resolve(result),
          }
          return chain
        },
      }
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, calls }
}

describe('fenceQaForHumanEdit', () => {
  it('flips queued, running AND retriable error rows to skipped, scoped to the job', async () => {
    const { supabase, calls } = fake({ data: [{ id: 'p1' }], error: null })
    expect(await fenceQaForHumanEdit(supabase, 'p1', { contentJobId: 'j1' })).toBe(true)
    expect(QA_FENCED_STATUSES).toEqual(['queued', 'running', 'error'])
    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('generated_pages')
    expect(calls[0].payload).toEqual({ qa_status: 'skipped' })
    expect(calls[0].filters).toEqual([
      ['eq', 'id', 'p1'],
      ['eq', 'content_job_id', 'j1'],
      ['in', 'qa_status', ['queued', 'running', 'error']],
    ])
  })

  it('scopes the public client-review fence to flagged pages', async () => {
    const { supabase, calls } = fake({ data: [], error: null })
    expect(await fenceQaForHumanEdit(supabase, 'p1', { contentJobId: 'j1', needsClientReview: true })).toBe(false)
    expect(calls[0].filters).toContainEqual(['eq', 'needs_client_review', true])
  })

  it('fails soft on a DB error (never blocks the human edit)', async () => {
    const { supabase } = fake({ data: null, error: { message: 'boom' } })
    expect(await fenceQaForHumanEdit(supabase, 'p1', { contentJobId: 'j1' })).toBe(false)
  })
})
