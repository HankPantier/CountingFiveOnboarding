import { beforeEach, describe, expect, it, vi } from 'vitest'

// Recording fake: every generated_pages update is logged in call order so the
// test can prove the QA fence lands BEFORE the human's content write.
const h = vi.hoisted(() => ({ writes: [] as Array<Record<string, unknown>> }))

vi.mock('next/server', async (orig) => {
  const mod = await orig<typeof import('next/server')>()
  return { ...mod, after: () => {} }
})
vi.mock('@/lib/auth/access', () => ({
  requireContentJobAccess: vi.fn(async () => ({ user: { id: 'u' }, sessionId: 'sess-1' })),
}))
vi.mock('@/lib/mbp/impact-review', () => ({ reviewContentForMbpImpact: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        h.writes.push(payload)
        const fence = payload.qa_status === 'skipped'
        const chain = {
          eq: () => chain,
          in: () => chain,
          select: () => (fence ? Promise.resolve({ data: [{ id: 'p1' }], error: null }) : chain),
          single: () => Promise.resolve({ data: { id: 'p1', page_url: '/a', content_markdown: 'x', ...payload }, error: null }),
        }
        return chain
      },
    }),
  }),
}))

import { PATCH } from './route'

const params = { params: Promise.resolve({ id: 'j1', pageId: 'p1' }) }
const patch = (body: unknown) => PATCH(new Request('http://test', { method: 'PATCH', body: JSON.stringify(body) }), params)

beforeEach(() => { h.writes = [] })

describe('PATCH /api/content-jobs/[id]/pages/[pageId] — QA fence', () => {
  it('fences QA BEFORE writing a human content edit', async () => {
    const res = await patch({ content_markdown: 'human text' })
    expect(res.status).toBe(200)
    expect(h.writes).toHaveLength(2)
    expect(h.writes[0]).toEqual({ qa_status: 'skipped' })
    expect(h.writes[1]).toMatchObject({ content_markdown: 'human text', admin_approved_content: false })
  })

  it('fences QA before an approval write', async () => {
    await patch({ admin_approved_content: true })
    expect(h.writes[0]).toEqual({ qa_status: 'skipped' })
    expect(h.writes[1]).toEqual({ admin_approved_content: true })
  })

  it('does not fence a flag-only change', async () => {
    await patch({ needs_client_review: true })
    expect(h.writes).toEqual([{ needs_client_review: true }])
  })
})
