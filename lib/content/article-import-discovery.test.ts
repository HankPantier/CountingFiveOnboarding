import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditResult } from '@/types/audit-result'

const h = vi.hoisted(() => ({
  job: { session_id: 'sess-1' } as { session_id: string } | null,
  run: null as { id: string; result: unknown } | null,
}))

// Table-routed builder: content_jobs → job, audit_runs → run. All chain methods
// return `this`; the terminal .single()/.maybeSingle() resolve the fixture.
vi.mock('@/lib/supabase/server', () => {
  function builder(table: string) {
    const api = {
      select: () => api,
      eq: () => api,
      order: () => api,
      limit: () => api,
      single: async () => ({ data: table === 'content_jobs' ? h.job : null, error: null }),
      maybeSingle: async () => ({ data: table === 'audit_runs' ? h.run : null, error: null }),
    }
    return api
  }
  return { createServerClient: () => ({ from: (t: string) => builder(t) }) }
})

import { discoverImportableArticles } from './article-import-discovery'

function auditResult(): AuditResult {
  return {
    raw: {
      pages: [
        { url: 'https://x.com/blog/tax-tips', status_code: 200, html: '<article>x</article>' },
        { url: 'https://x.com/blog/short', status_code: 200, html: '<article>x</article>' },
        { url: 'https://x.com/blog', status_code: 200, html: '<article>x</article>' }, // section root
        { url: 'https://x.com/about', status_code: 200, html: '<article>x</article>' }, // not an article
        { url: 'https://x.com/resources/guide', status_code: 404, html: '' }, // not 200
        { url: 'https://x.com/insights/growth', status_code: 200, html: '<article>x</article>' },
      ],
      analyzed: [
        { title: 'Tax Tips', meta_desc: 'Save tax', word_count: 800, imgs_total: 2 },
        { title: 'Short', meta_desc: '', word_count: 40, imgs_total: 0 }, // below MIN_WORD_COUNT
        { title: 'Blog', meta_desc: '', word_count: 500, imgs_total: 0 },
        { title: 'About', meta_desc: '', word_count: 500, imgs_total: 0 },
        { title: 'Guide', meta_desc: '', word_count: 500, imgs_total: 0 },
        { title: 'Growth', meta_desc: 'Grow', word_count: 300, imgs_total: 0 },
      ],
    },
    intelligence: {
      content_library: {
        total_pieces: 5,
        formats: [],
        syndication_assessment: 'Much of this content appears syndicated / white-label.',
        recommendations: [],
      },
    },
  } as unknown as AuditResult
}

beforeEach(() => {
  h.job = { session_id: 'sess-1' }
  h.run = { id: 'run-1', result: auditResult() }
})

describe('discoverImportableArticles', () => {
  it('keeps only 200 article URLs with sufficient word count', async () => {
    const { articles, auditRunId } = await discoverImportableArticles('job-1')
    const urls = articles.map((a) => a.url)
    expect(auditRunId).toBe('run-1')
    expect(urls).toEqual(['https://x.com/blog/tax-tips', 'https://x.com/insights/growth'])
    expect(urls).not.toContain('https://x.com/blog') // section root excluded
    expect(urls).not.toContain('https://x.com/about') // non-article excluded
    expect(urls).not.toContain('https://x.com/blog/short') // too short
    expect(urls).not.toContain('https://x.com/resources/guide') // not 200
  })

  it('surfaces the syndication assessment and projects the hint', async () => {
    const { articles, syndicationAssessment } = await discoverImportableArticles('job-1')
    expect(syndicationAssessment).toMatch(/syndicated/i)
    expect(articles.every((a) => a.isSyndicatedHint)).toBe(true)
    expect(articles[0]).toMatchObject({ title: 'Tax Tips', wordCount: 800, hasImages: true })
  })

  it('returns empty when the session has no completed audit', async () => {
    h.run = null
    const { articles, auditRunId } = await discoverImportableArticles('job-1')
    expect(articles).toEqual([])
    expect(auditRunId).toBeNull()
  })

  it('returns empty when the job has no session', async () => {
    h.job = null
    const { articles } = await discoverImportableArticles('job-1')
    expect(articles).toEqual([])
  })
})
