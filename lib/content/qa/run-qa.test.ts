import { describe, it, expect, vi } from 'vitest'
import { runQaForPage } from './run-qa'
import { makeFakeSupabase } from './test-fake-supabase'

const page = {
  id: 'p1', content_job_id: 'j1', page_url: '/a', page_title: 'A', generation_status: 'complete',
  admin_approved_content: false, qa_status: 'queued', qa_attempts: 0,
  content_markdown: '<!-- block: content-split | variant: image-right -->\n## A\n\nText here.\n\n<!-- block: content-split | variant: image-right -->\n## B\n\nMore here.\n',
  meta_title: 'x'.repeat(55), meta_description: 'y'.repeat(155), target_keyword: 'tax',
  hero_block: 'hero', hero_variant: 'image', hero_subhead: null, faq_block: null,
}
const ctx = { sessionId: 's1', websiteUrl: '', schema: {}, palette: null, sitemapUrls: ['/a'], researchByUrl: new Map(), templateVersion: null }

function deps(mode: 'on' | 'shadow', fakeOpts = {}) {
  const supabase = makeFakeSupabase(
    { generated_pages: [page], page_outlines: [{ content_job_id: 'j1', page_url: '/a', sections: [], generation_mode: 'generate' }] },
    fakeOpts,
  )
  return {
    supabase,
    deps: {
      supabase,
      mode,
      loadContext: vi.fn().mockResolvedValue(ctx),
      specialists: vi.fn().mockResolvedValue([]),
      judge: vi.fn().mockResolvedValue(null),
      noGo: vi.fn().mockResolvedValue([]),
      now: () => '2026-10-01T00:00:00.000Z',
    },
  }
}

describe('runQaForPage', () => {
  it('on mode applies the alternation fix and stores the review', async () => {
    const { supabase, deps: d } = deps('on')
    expect(await runQaForPage('j1', 'p1', d)).toEqual({ status: 'done' })
    const final = supabase.updates('generated_pages').at(-1)! as Record<string, unknown>
    expect(final.qa_status).toBe('done')
    expect(final.content_markdown).toContain('variant: image-left')
    const review = final.qa_review as { findings: Array<Record<string, unknown>> }
    expect(review.findings[0]).toMatchObject({ kind: 'media_side', status: 'applied' })
  })

  it('shadow mode writes the review but not the content', async () => {
    const { supabase, deps: d } = deps('shadow')
    await runQaForPage('j1', 'p1', d)
    const final = supabase.updates('generated_pages').at(-1)! as Record<string, unknown>
    expect(final.content_markdown).toBeUndefined()
    const review = final.qa_review as { findings: Array<Record<string, unknown>> }
    expect(review.findings[0].status).toBe('open')
  })

  it('skips when the claim is lost', async () => {
    const { deps: d } = deps('on', { claimReturnsEmpty: true })
    expect((await runQaForPage('j1', 'p1', d)).status).toBe('skipped')
  })

  it('returns skipped when the final fenced write matches nothing (human edit won)', async () => {
    const { deps: d } = deps('on', { finalWriteReturnsEmpty: true })
    expect((await runQaForPage('j1', 'p1', d)).status).toBe('skipped')
  })

  it('marks qa error (never generation error) on a throw', async () => {
    const { supabase, deps: d } = deps('on')
    d.specialists = vi.fn().mockRejectedValue(new Error('boom'))
    expect((await runQaForPage('j1', 'p1', d)).status).toBe('error')
    const last = supabase.updates('generated_pages').at(-1)!
    expect(last).toEqual({ qa_status: 'error' })
  })

  it('skips verbatim pages from the judge', async () => {
    const { deps: d } = deps('on')
    d.supabase = makeFakeSupabase(
      { generated_pages: [page], page_outlines: [{ content_job_id: 'j1', page_url: '/a', sections: [], generation_mode: 'verbatim' }] },
    )
    await runQaForPage('j1', 'p1', d)
    expect(d.judge).not.toHaveBeenCalled()
  })
})
