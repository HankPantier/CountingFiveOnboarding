import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  idea: { id: 'idea-1', status: 'drafted', draft_status: 'complete' } as {
    id: string
    status: string
    draft_status: string
  },
  updatePayload: null as Record<string, unknown> | null,
}))

vi.mock('../../../_helpers', () => ({
  resolveEditContext: vi.fn(async () => ({
    jobId: 'job-1',
    sessionId: 'sess-1',
    user: { id: 'u', isAdmin: true, capabilities: [] },
  })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      let kind: 'select' | 'update' = 'select'
      const builder: Record<string, unknown> = {
        select() {
          kind = 'select'
          return builder
        },
        update(payload: Record<string, unknown>) {
          kind = 'update'
          h.updatePayload = payload
          return builder
        },
        eq() {
          return builder
        },
        single: async () => ({ data: h.idea }),
        then(resolve: (v: unknown) => void) {
          resolve(kind === 'update' ? { error: null } : { data: h.idea })
        },
      }
      return builder
    },
  }),
}))

import { PATCH } from './route'

const params = Promise.resolve({
  id: '11111111-1111-1111-1111-111111111111',
  ideaId: '22222222-2222-2222-2222-222222222222',
})
const patch = (body: unknown) =>
  PATCH(new Request('http://test', { method: 'PATCH', body: JSON.stringify(body) }), { params })

beforeEach(() => {
  h.idea = { id: 'idea-1', status: 'drafted', draft_status: 'complete' }
  h.updatePayload = null
})

describe('PATCH /api/edit/[id]/resources/ideas/[ideaId] — reclassify', () => {
  it('allows a content-type relabel on an already-drafted idea', async () => {
    const res = await patch({ contentType: 'article' })
    expect(res.status).toBe(200)
    expect(h.updatePayload?.content_type).toBe('article')
    expect(h.updatePayload?.status).toBeUndefined()
  })

  it('still blocks a status change on a drafted idea (409)', async () => {
    const res = await patch({ status: 'approved' })
    expect(res.status).toBe(409)
  })

  it('blocks any change while a draft is running (409)', async () => {
    h.idea = { id: 'idea-1', status: 'approved', draft_status: 'running' }
    const res = await patch({ contentType: 'article' })
    expect(res.status).toBe(409)
  })

  it('rejects an empty body (400)', async () => {
    const res = await patch({})
    expect(res.status).toBe(400)
  })

  it('rejects an unknown content type (400)', async () => {
    const res = await patch({ contentType: 'newsletter' })
    expect(res.status).toBe(400)
  })
})
