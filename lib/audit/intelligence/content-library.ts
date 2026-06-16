// Ongoing Content — Resource Library analysis. Inventory + publishing cadence
// are computed deterministically from the sitemap; Claude judges whether the
// content is original or syndicated/white-labeled and what to do about it.
import { generateMbpJson } from '@/lib/mbp/generate-json'
import type { AuditResult, ContentLibraryFormat, ContentLibraryIntelligence } from '../types'

const ARTICLE_URL_RE = /\/(blog|resources?|insights?|articles?|news|posts?|quick-?reads?|magazine)\b/i
const MIN_PIECES = 3
const MS_PER_MONTH = 30.44 * 24 * 60 * 60 * 1000

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
    : []

/** Human cadence string from a set of lastmod date strings. */
function describeCadence(dates: Date[]): string {
  if (dates.length < 2) return 'insufficient data'
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())
  const spanMs = sorted[sorted.length - 1].getTime() - sorted[0].getTime()
  const months = Math.max(1, spanMs / MS_PER_MONTH)
  const perMonth = dates.length / months
  if (perMonth >= 4) return `~${Math.round(perMonth)} per month`
  if (perMonth >= 1) return `~${perMonth.toFixed(1)} per month`
  const perYear = perMonth * 12
  return `~${Math.max(1, Math.round(perYear))} per year`
}

function parseDate(value: string): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

interface JudgeModel {
  syndication_assessment?: unknown
  recommendations?: unknown
}

export async function analyzeContentLibrary(
  result: AuditResult,
): Promise<ContentLibraryIntelligence | null> {
  const sitemap = result.sitemap
  const entries = sitemap?.page_entries ?? []
  const articleEntries = entries.filter((e) => e.type === 'post' || ARTICLE_URL_RE.test(e.url))

  // Fall back to crawled article-looking pages when the sitemap is thin.
  const crawledArticles = (result.page_analysis_summary ?? []).filter((p) => ARTICLE_URL_RE.test(p.url))
  const total_pieces = Math.max(articleEntries.length, sitemap?.posts ?? 0, crawledArticles.length)
  if (total_pieces < MIN_PIECES) return null

  const dates = articleEntries
    .map((e) => parseDate(e.lastmod))
    .filter((d): d is Date => d !== null)

  const formats: ContentLibraryFormat[] = []
  if (articleEntries.length || (sitemap?.posts ?? 0)) {
    formats.push({
      type: 'Articles / Posts',
      count: Math.max(articleEntries.length, sitemap?.posts ?? 0),
      cadence: describeCadence(dates),
    })
  }

  // Gather text from crawled article pages so Claude can judge syndication.
  const analyzed = result.raw?.analyzed ?? []
  const summaries = result.page_analysis_summary ?? []
  const sampleText = summaries
    .map((s, i) => ({ url: s.url, title: s.title, text: analyzed[i]?.page_text_sample || s.content_snippet || '' }))
    .filter((p) => ARTICLE_URL_RE.test(p.url) && p.text)
    .slice(0, 12)
    .map((p) => `### ${p.title || p.url}\nURL: ${p.url}\n${p.text}`)
    .join('\n\n')

  let syndication_assessment = ''
  let recommendations: string[] = []

  if (sampleText) {
    const prompt = `You are reviewing a professional-services firm's online content library (${total_pieces} pieces, cadence ${formats[0]?.cadence ?? 'unknown'}). From the article samples below, judge whether the content is ORIGINAL/firm-authored or SYNDICATED/white-labeled (look for third-party bylines like "by ADP", generic non-local topics, no firm voice, missing per-article SEO). Also note any local or niche relevance (or absence).

Return JSON:
{ "syndication_assessment": "3-5 sentences on originality, local/niche relevance, and SEO quality of this content library", "recommendations": [ up to 5 concrete recommendations ] }
Return only the JSON.

ARTICLE SAMPLES:
${sampleText}`

    const judged = await generateMbpJson<{ syndication_assessment: string; recommendations: string[] }>(
      prompt,
      (parsed) => {
        const p = parsed as JudgeModel
        const sa = asStr(p.syndication_assessment)
        const recs = asStrArr(p.recommendations)
        if (!sa && !recs.length) return null
        return { syndication_assessment: sa, recommendations: recs }
      },
      1200,
    )
    if (judged) {
      syndication_assessment = judged.syndication_assessment
      recommendations = judged.recommendations
    }
  }

  return { total_pieces, formats, syndication_assessment, recommendations }
}
