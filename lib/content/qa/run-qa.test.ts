import { describe, it, expect, vi } from 'vitest'
import { runQaForPage } from './run-qa'
import { makeFakeSupabase } from './test-fake-supabase'
import { QA_MAX_ATTEMPTS } from './mode'

const page = {
  id: 'p1', content_job_id: 'j1', page_url: '/a', page_title: 'A', generation_status: 'complete',
  admin_approved_content: false, qa_status: 'queued', qa_attempts: 0,
  content_markdown: '<!-- block: content-split | variant: image-right -->\n## A\n\nText here.\n\n<!-- block: content-split | variant: image-right -->\n## B\n\nMore here.\n',
  meta_title: 'x'.repeat(55), meta_description: 'y'.repeat(155), target_keyword: 'tax',
  hero_block: 'hero', hero_variant: 'image', hero_subhead: null, faq_block: null,
}
const ctx = { sessionId: 's1', websiteUrl: '', schema: {}, palette: null, sitemapUrls: ['/a'], researchByUrl: new Map(), templateVersion: null }

function deps(mode: 'on' | 'shadow', fakeOpts = {}, jobPhase = 5) {
  const supabase = makeFakeSupabase(
    {
      generated_pages: [page],
      page_outlines: [{ content_job_id: 'j1', page_url: '/a', sections: [], generation_mode: 'generate' }],
      content_jobs: [{ id: 'j1', phase: jobPhase }],
    },
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

  it('fences the claim and the final write with the required filters', async () => {
    const { supabase, deps: d } = deps('on')
    expect(await runQaForPage('j1', 'p1', d)).toEqual({ status: 'done' })
    const allFilters = supabase.updateFilters('generated_pages')
    expect(allFilters).toHaveLength(2)
    const [claimFilters, finalFilters] = allFilters
    expect(claimFilters).toEqual(expect.arrayContaining([
      ['in', 'qa_status', ['queued', 'error']],
      ['lt', 'qa_attempts', QA_MAX_ATTEMPTS],
      ['eq', 'generation_status', 'complete'],
      ['eq', 'admin_approved_content', false],
    ]))
    expect(finalFilters).toEqual(expect.arrayContaining([
      ['eq', 'qa_status', 'running'],
      ['eq', 'qa_started_at', '2026-10-01T00:00:00.000Z'],
      ['eq', 'generation_status', 'complete'],
    ]))
  })

  it('fences to error (not a silent "not verbatim") when the outline read fails', async () => {
    const { deps: d } = deps('on')
    d.supabase = makeFakeSupabase(
      { generated_pages: [page], page_outlines: [{ content_job_id: 'j1', page_url: '/a', sections: [], generation_mode: 'generate' }] },
      { selectErrors: { page_outlines: { message: 'outline read boom' } } },
    )
    expect((await runQaForPage('j1', 'p1', d)).status).toBe('error')
    expect(d.supabase.updates('generated_pages').at(-1)).toEqual({ qa_status: 'error' })
  })

  it('returns error with no write when the initial page read fails', async () => {
    const { deps: d } = deps('on')
    d.supabase = makeFakeSupabase(
      { generated_pages: [page], page_outlines: [{ content_job_id: 'j1', page_url: '/a', sections: [], generation_mode: 'generate' }] },
      { selectErrors: { generated_pages: { message: 'row read boom' } } },
    )
    const result = await runQaForPage('j1', 'p1', d)
    expect(result).toEqual({ status: 'error', reason: 'page read failed' })
    expect(d.supabase.updates('generated_pages')).toEqual([])
  })

  it('on mode is report-only once the job has left phase 5 (no late patches on a page being proofed)', async () => {
    const { supabase, deps: d } = deps('on', {}, 6)
    expect(await runQaForPage('j1', 'p1', d)).toEqual({ status: 'done' })
    const final = supabase.updates('generated_pages').at(-1)! as Record<string, unknown>
    expect(final.qa_status).toBe('done')
    expect(final.content_markdown).toBeUndefined()
    expect(final.meta_title).toBeUndefined()
    expect(final.meta_description).toBeUndefined()
    const review = final.qa_review as { findings: Array<Record<string, unknown>> }
    expect(review.findings[0]).toMatchObject({ kind: 'media_side', status: 'open' })
  })

  it('on mode is report-only when the job phase cannot be read', async () => {
    const { deps: d } = deps('on')
    d.supabase = makeFakeSupabase({
      generated_pages: [page],
      page_outlines: [{ content_job_id: 'j1', page_url: '/a', sections: [], generation_mode: 'generate' }],
      content_jobs: [],
    })
    await runQaForPage('j1', 'p1', d)
    const final = d.supabase.updates('generated_pages').at(-1)! as Record<string, unknown>
    expect(final.content_markdown).toBeUndefined()
  })

  it('a judge failure on a generated page fails QA with a judge_unavailable flag and clears critic_review (on)', async () => {
    const { supabase, deps: d } = deps('on')
    await runQaForPage('j1', 'p1', d)
    const final = supabase.updates('generated_pages').at(-1)! as Record<string, unknown>
    const review = final.qa_review as { passed: boolean; findings: Array<Record<string, unknown>> }
    expect(review.passed).toBe(false)
    expect(review.findings).toContainEqual(expect.objectContaining({
      agent: 'judge', severity: 'high', kind: 'judge_unavailable', status: 'open',
    }))
    expect('critic_review' in final).toBe(true)
    expect(final.critic_review).toBeNull()
  })

  it('a judge failure in shadow mode leaves critic_review alone', async () => {
    const { supabase, deps: d } = deps('shadow')
    await runQaForPage('j1', 'p1', d)
    const final = supabase.updates('generated_pages').at(-1)! as Record<string, unknown>
    expect('critic_review' in final).toBe(false)
    expect((final.qa_review as { passed: boolean }).passed).toBe(false)
  })

  it('verbatim pages (judge skipped by design) get no judge_unavailable flag', async () => {
    const { deps: d } = deps('on')
    d.supabase = makeFakeSupabase({
      generated_pages: [page],
      page_outlines: [{ content_job_id: 'j1', page_url: '/a', sections: [], generation_mode: 'verbatim' }],
      content_jobs: [{ id: 'j1', phase: 5 }],
    })
    await runQaForPage('j1', 'p1', d)
    const final = d.supabase.updates('generated_pages').at(-1)! as Record<string, unknown>
    const review = final.qa_review as { findings: Array<Record<string, unknown>> }
    expect(review.findings.some(f => f.kind === 'judge_unavailable')).toBe(false)
  })

  it("records the QA judge's spend under the qa_judge stage", async () => {
    const { deps: d } = deps('on')
    await runQaForPage('j1', 'p1', d)
    expect(d.judge).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ stage: 'qa_judge' }))
  })
})
