import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QaReview } from '@/types/qa-review'

const md5 = (s: string) => createHash('md5').update(s).digest('hex')

vi.mock('next/server', async (orig) => {
  const mod = await orig<typeof import('next/server')>()
  return { ...mod, after: (fn: () => unknown) => { void fn() } }
})
// vi.mock factories are hoisted above top-level consts, so the fakes are too.
const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  updateRows: [] as Array<Record<string, unknown>>,
}))
const { requireContentJobAccess, reviewContentForMbpImpact, fenceQaForHumanEdit, rpc } = vi.hoisted(() => ({
  requireContentJobAccess: vi.fn(async () => ({ user: { id: 'u' }, sessionId: 'sess-1' })),
  reviewContentForMbpImpact: vi.fn().mockResolvedValue(undefined),
  fenceQaForHumanEdit: vi.fn().mockResolvedValue(false),
  rpc: vi.fn(),
}))
vi.mock('@/lib/auth/access', () => ({ requireContentJobAccess }))
vi.mock('@/lib/mbp/impact-review', () => ({ reviewContentForMbpImpact }))
vi.mock('@/lib/content/qa/fence', () => ({ fenceQaForHumanEdit }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({
      select: () => {
        const chain = { eq: () => chain, maybeSingle: () => Promise.resolve({ data: h.row, error: null }) }
        return chain
      },
    }),
    rpc,
  }),
}))

import { PATCH } from './route'

const params = { params: Promise.resolve({ id: 'j1', pageId: 'p1' }) }
const patch = (body: unknown) =>
  PATCH(new Request('http://test', { method: 'PATCH', body: JSON.stringify(body) }), params)

const review: QaReview = {
  mode: 'on', ran_at: 't', judge: null, passed: false, scores: { accuracy: 7, copy: 10, seo: 10, structure: 10 },
  findings: [{
    id: 'f1', agent: 'accuracy', severity: 'high', kind: 'unsupported_claim', quote: 'since 1998', message: 'm',
    patch: { target: 'body', find: 'We have served Austin since 1998.', replace: 'We serve Austin.' },
    safety: 'flag', status: 'open',
  }],
}

beforeEach(() => {
  h.row = { content_markdown: 'We have served Austin since 1998.\n', meta_title: 't', meta_description: 'd', qa_review: review, page_url: '/a' }
  h.updateRows = [{ id: 'p1', content_markdown: 'We serve Austin.\n', meta_title: 't', meta_description: 'd', page_url: '/a' }]
  requireContentJobAccess.mockClear()
  reviewContentForMbpImpact.mockClear()
  fenceQaForHumanEdit.mockClear()
  rpc.mockReset()
  rpc.mockImplementation(async () => ({ data: h.updateRows, error: null }))
})

describe('PATCH /api/content-jobs/[id]/pages/[pageId]/qa-findings', () => {
  it('400s on a bad body', async () => {
    const res = await patch({ findingId: 'f1', action: 'maybe' })
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('409s when the review has no finding with that id', async () => {
    const res = await patch({ findingId: 'nope', action: 'dismiss' })
    expect(res.status).toBe(409)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('applies the change via the server-side CAS rpc and returns {page, qaReview}', async () => {
    const res = await patch({ findingId: 'f1', action: 'apply' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.page.content_markdown).toBe('We serve Austin.\n')
    expect(json.qaReview.findings[0].status).toBe('accepted')
    expect(json.qaReview.passed).toBe(true)
    expect(json.qaReview.rev).toBe(1)

    expect(rpc).toHaveBeenCalledWith('qa_apply_page_update', {
      p_page_id: 'p1',
      p_job_id: 'j1',
      p_expected_content_md5: md5('We have served Austin since 1998.\n'),
      p_expected_rev: 0,
      p_qa_review: expect.objectContaining({ rev: 1 }),
      p_content_changed: true,
      p_content: 'We serve Austin.\n',
      p_meta_title: 't',
      p_meta_description: 'd',
    })
    expect(fenceQaForHumanEdit).toHaveBeenCalledWith(expect.anything(), 'p1', { contentJobId: 'j1' })
    expect(reviewContentForMbpImpact).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess-1', origin: 'page_edit', sourceRef: '/a', changedText: 'We serve Austin.\n',
    }))
  })

  it('dismiss passes a null md5 so an unrelated content edit never 409s it, and skips the fence', async () => {
    const res = await patch({ findingId: 'f1', action: 'dismiss' })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('qa_apply_page_update', expect.objectContaining({
      p_expected_content_md5: null,
      p_expected_rev: 0,
      p_content_changed: false,
      p_content: null,
      p_meta_title: null,
      p_meta_description: null,
    }))
    expect(fenceQaForHumanEdit).not.toHaveBeenCalled()
    expect(reviewContentForMbpImpact).not.toHaveBeenCalled()
  })

  it('uses the review\'s existing rev as the expected rev', async () => {
    h.row = { ...h.row, qa_review: { ...review, rev: 5 } }
    await patch({ findingId: 'f1', action: 'dismiss' })
    expect(rpc).toHaveBeenCalledWith('qa_apply_page_update', expect.objectContaining({ p_expected_rev: 5 }))
  })

  it('409s when the CAS rpc returns zero rows', async () => {
    h.updateRows = []
    const res = await patch({ findingId: 'f1', action: 'dismiss' })
    expect(res.status).toBe(409)
  })

  it('internalError on an rpc failure', async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { message: 'boom' } }))
    const res = await patch({ findingId: 'f1', action: 'dismiss' })
    expect(res.status).toBe(500)
  })
})
