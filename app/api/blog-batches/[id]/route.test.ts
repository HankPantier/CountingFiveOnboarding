import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  user: { id: 'u', isAdmin: true, capabilities: ['manager'] } as {
    id: string
    isAdmin: boolean
    capabilities: string[]
  },
  allowed: null as string[] | null,
  batch: { id: 'batch-1' } as { id: string } | null,
  targets: [{ resource_idea_id: 'idea-1' }, { resource_idea_id: null }] as Array<{
    resource_idea_id: string | null
  }>,
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}))

vi.mock('@/lib/auth/access', () => ({
  getCurrentUser: vi.fn(async () => h.user),
  getAccessibleSessionIds: vi.fn(async () => h.allowed),
  hasCapability: (u: { isAdmin?: boolean; capabilities?: string[] }, cap: string) =>
    !!u?.isAdmin || !!u?.capabilities?.includes(cap),
  requireAdminUser: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      let kind: 'select' | 'update' = 'select'
      const builder: Record<string, unknown> = {
        select() {
          kind = 'select'
          return builder
        },
        update(payload: Record<string, unknown>) {
          kind = 'update'
          h.updates.push({ table, payload })
          return builder
        },
        eq() {
          return builder
        },
        in() {
          return builder
        },
        limit() {
          return builder
        },
        single: async () => (table === 'blog_batches' ? { data: h.batch } : { data: null }),
        then(resolve: (v: unknown) => void) {
          if (kind === 'update') resolve({ error: null })
          else resolve({ data: table === 'blog_batch_targets' ? h.targets : [] })
        },
      }
      return builder
    },
  }),
}))

import { PATCH } from './route'

const params = Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' })
const patch = (body: unknown) =>
  PATCH(new Request('http://test', { method: 'PATCH', body: JSON.stringify(body) }), { params })

beforeEach(() => {
  h.user = { id: 'u', isAdmin: true, capabilities: ['manager'] }
  h.allowed = null
  h.batch = { id: 'batch-1' }
  h.targets = [{ resource_idea_id: 'idea-1' }, { resource_idea_id: null }]
  h.updates = []
})

describe('PATCH /api/blog-batches/[id] — reclassify', () => {
  it('cascades the new content type to batch, targets, and linked ideas', async () => {
    const res = await patch({ contentType: 'article' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; contentType: string }
    expect(body).toEqual({ success: true, contentType: 'article' })

    const byTable = (t: string) => h.updates.find((u) => u.table === t)
    expect(byTable('blog_batches')?.payload.content_type).toBe('article')
    expect(byTable('blog_batch_targets')?.payload.content_type).toBe('article')
    // Only the non-null resource_idea_id is updated.
    expect(byTable('resource_ideas')?.payload.content_type).toBe('article')
  })

  it('rejects an unknown content type (400)', async () => {
    const res = await patch({ contentType: 'newsletter' })
    expect(res.status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })

  it('403s a member without the manager capability', async () => {
    h.user = { id: 'u', isAdmin: false, capabilities: [] }
    const res = await patch({ contentType: 'article' })
    expect(res.status).toBe(403)
  })

  it('403s a manager with no assigned client in the batch', async () => {
    h.user = { id: 'u', isAdmin: false, capabilities: ['manager'] }
    h.allowed = []
    const res = await patch({ contentType: 'article' })
    expect(res.status).toBe(403)
  })
})
