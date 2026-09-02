import { createServerClient } from '@/lib/supabase/server'
import { ARTICLE_URL_RE } from '@/lib/audit/intelligence/content-library'
import type { AuditResult, CrawledPage, PageAnalysis } from '@/types/audit-result'

// The minimum body length for an article to be worth importing verbatim. Below
// this a "page" is almost always a listing/category stub, not a real article.
const MIN_WORD_COUNT = 150

// A crawled article from the client's CURRENT site that an operator can bring
// into the new site AS-IS. The verbatim body is NOT carried here — it is re-read
// from the audit result at import time (audit_runs.result.raw.pages[].html).
export interface DiscoveredArticle {
  url: string
  title: string
  metaDescription: string
  wordCount: number
  hasImages: boolean
  // Sitewide syndication suspicion projected onto each article so the UI can
  // default-deselect boilerplate; there is no per-article syndication signal.
  isSyndicatedHint: boolean
}

export interface ArticleDiscovery {
  auditRunId: string | null
  articles: DiscoveredArticle[]
  syndicationAssessment: string
}

const EMPTY: ArticleDiscovery = { auditRunId: null, articles: [], syndicationAssessment: '' }

const SYNDICATION_RE = /syndicat|white.?label|licensed|purchased|not original|third.?part|boilerplate/i

// A section root ("/blog", "/resources") matches ARTICLE_URL_RE but is a listing
// page, not an article. Real articles live one or more segments deeper.
function isArticleUrl(rawUrl: string): boolean {
  let pathname: string
  try {
    pathname = new URL(rawUrl).pathname
  } catch {
    pathname = rawUrl
  }
  if (!ARTICLE_URL_RE.test(pathname)) return false
  const segments = pathname.split('/').filter(Boolean)
  return segments.length >= 2
}

// The client's own existing articles, discovered during the audit crawl, that
// can be imported verbatim. Resolves the newest COMPLETE audit for the job's
// session, then re-derives article candidates from the crawl (the aggregate
// content-library intelligence carries no per-URL data). Never throws — a
// session with no audit (or no blog) yields an empty list, so the phase gate
// can auto-clear rather than deadlock.
export async function discoverImportableArticles(contentJobId: string): Promise<ArticleDiscovery> {
  const supabase = createServerClient()

  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id')
    .eq('id', contentJobId)
    .single()
  if (!job?.session_id) return EMPTY

  const { data: run } = await supabase
    .from('audit_runs')
    .select('id, result')
    .eq('session_id', job.session_id)
    .eq('audit_status', 'complete')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!run?.result) return { ...EMPTY }

  const result = run.result as unknown as AuditResult
  const pages: CrawledPage[] = result.raw?.pages ?? []
  const analyzed: PageAnalysis[] = result.raw?.analyzed ?? []
  const syndicationAssessment = result.intelligence?.content_library?.syndication_assessment ?? ''
  const syndicatedSitewide = SYNDICATION_RE.test(syndicationAssessment)

  const articles: DiscoveredArticle[] = []
  const seen = new Set<string>()
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    if (!page || page.status_code !== 200 || !page.html) continue
    if (!isArticleUrl(page.url)) continue
    if (seen.has(page.url)) continue
    // pages[] and analyzed[] are parallel arrays (same index → same page).
    const meta = analyzed[i]
    const wordCount = meta?.word_count ?? 0
    if (wordCount < MIN_WORD_COUNT) continue
    seen.add(page.url)
    articles.push({
      url: page.url,
      title: meta?.title?.trim() || page.url,
      metaDescription: meta?.meta_desc?.trim() ?? '',
      wordCount,
      hasImages: (meta?.imgs_total ?? 0) > 0,
      isSyndicatedHint: syndicatedSitewide,
    })
  }

  return { auditRunId: run.id, articles, syndicationAssessment }
}
