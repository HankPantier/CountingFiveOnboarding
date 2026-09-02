import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  allowed: null as string[] | null,
  targets: [{ id: 't1', resource_idea_id: 'idea-1', session_id: 'sess-1' }],
  filters: [] as Array<{ table: string; method: string; args: unknown[] }>,
  after: vi.fn(),
  runBlogBatch: vi.fn(),
}))

vi.mock('@/lib/auth/access', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'u', isAdmin: true })),
  getAccessibleSessionIds: vi.fn(async () => h.allowed),
}))
vi.mock('@/lib/content/blog-batch-runner', () => ({
  runBlogBatch: (...a: unknown[]) => h.runBlogBatch(...a),
}))
vi.mock('next/server', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, after: (fn: () => void) => h.after(fn) }
})
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      let kind: 'select' | 'update' = 'select'
      const builder: Record<string, unknown> = {
        select() {
          kind = 'select'
          return builder
        },
        update() {
          kind = 'update'
          return builder
        },
        eq(...args: unknown[]) {
          if (kind === 'select') h.filters.push({ table, method: 'eq', args })
          return builder
        },
        in(...args: unknown[]) {
          if (kind === 'select') h.filters.push({ table, method: 'in', args })
          return builder
        },
        single: async () => (table === 'blog_batches' ? { data: { id: 'b1' } } : { data: null }),
        then(resolve: (v: unknown) => void) {
          if (kind === 'update') resolve({ error: null })
          else resolve({ data: table === 'blog_batch_targets' ? h.targets : [] })
        },
      }
      return builder
    },
  }),
}))

import { POST } from './route'

const params = Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' })
const post = (body: unknown) =>
  POST(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }), { params })

const SESSION = '33333333-3333-3333-3333-333333333333'

beforeEach(() => {
  h.allowed = null
  h.targets = [{ id: 't1', resource_idea_id: 'idea-1', session_id: SESSION }]
  h.filters = []
  h.after.mockReset()
  h.runBlogBatch.mockReset()
})

const targetStatusFilter = () =>
  h.filters.filter((f) => f.table === 'blog_batch_targets' && f.args[0] === 'status')

describe('POST /api/blog-batches/[id]/retry', () => {
  it('force + sessionId re-drafts a settled (complete/error/skipped) target', async () => {
    const res = await post({ sessionId: SESSION, force: true })
    expect(res.status).toBe(200)
    expect((await res.json()) as { retried: number }).toEqual({ retried: 1 })
    expect(targetStatusFilter()).toEqual([
      { table: 'blog_batch_targets', method: 'in', args: ['status', ['complete', 'error', 'skipped']] },
    ])
    expect(h.after).toHaveBeenCalledOnce()
  })

  it('without force, only errored targets are picked up', async () => {
    const res = await post({})
    expect(res.status).toBe(200)
    expect(targetStatusFilter()).toEqual([
      { table: 'blog_batch_targets', method: 'eq', args: ['status', 'error'] },
    ])
  })

  it('force is ignored without a single sessionId (falls back to errored-only)', async () => {
    const res = await post({ force: true })
    expect(res.status).toBe(200)
    expect(targetStatusFilter()).toEqual([
      { table: 'blog_batch_targets', method: 'eq', args: ['status', 'error'] },
    ])
  })
})
