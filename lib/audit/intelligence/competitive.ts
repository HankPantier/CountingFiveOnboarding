// Competitive Search Visibility. Claude derives ~5 local-intent keywords from
// the firm's niche + location; we rank-check each via Serper (measured, not
// guessed); Claude then judges only AI-search presence and local-SEO. Requires
// a Serper key — returns null (section omitted) without one.
import { generateMbpJson } from '@/lib/mbp/generate-json'
import { getGrade } from '../scoring'
import { serperEnabled, serperSearch } from '../serper-search'
import type { CompetitiveIntelligence, DetectedNiche, KeywordRanking } from '../types'

const MAX_KEYWORDS = 5

export interface CompetitiveInput {
  siteName: string
  domain: string
  niches: DetectedNiche[]
  location: string
  signals: {
    hasFaqSchema: boolean
    hasLlmsTxt: boolean
    hasLocalBusiness: boolean
    aiCrawlersBlocked: string[]
  }
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
    : []

function clampScore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(10, Math.round(n)))
}

/** Deterministic 0–10 score for a measured SERP rank. */
function rankToScore(rank: number | null): number {
  if (rank === null) return 1
  if (rank <= 1) return 10
  if (rank <= 3) return 9
  if (rank <= 5) return 8
  if (rank <= 10) return 6
  if (rank <= 20) return 4
  return 2
}

function rankNote(rank: number | null): string {
  if (rank === null) return 'Not found in the first page of results'
  if (rank <= 3) return `Top 3 (position ${rank})`
  if (rank <= 10) return `First page (position ${rank})`
  return `Position ${rank}`
}

async function deriveKeywords(input: CompetitiveInput): Promise<string[] | null> {
  const nicheList = input.niches.map((n) => n.name).filter(Boolean).join(', ') || '(none stated)'
  const prompt = `A prospective client searching Google for "${input.siteName}" or a firm like it would type queries combining a service, an intent word, and a location. The firm's niches: ${nicheList}. Location: ${input.location || '(unknown)'}.

Return JSON: { "keywords": [ up to ${MAX_KEYWORDS} realistic buyer search queries ] }. Favor local-intent queries (service + location). If location is unknown, omit the location term. Return only the JSON.`

  const result = await generateMbpJson<{ keywords: string[] }>(
    prompt,
    (parsed) => {
      const kws = asStrArr((parsed as { keywords?: unknown })?.keywords).slice(0, MAX_KEYWORDS)
      return kws.length ? { keywords: kws } : null
    },
    600,
  )
  return result?.keywords ?? null
}

async function rankCheck(
  keyword: string,
  domain: string,
  location: string,
): Promise<KeywordRanking> {
  const results = await serperSearch(keyword, { location: location || undefined })
  if (results === null) return { keyword, rank: null, note: 'Rank check unavailable' }
  const hit = results.find((r) => {
    try {
      return new URL(r.link).host.toLowerCase().replace(/^www\./, '') === domain
    } catch {
      return false
    }
  })
  const rank = hit ? hit.position : null
  return { keyword, rank, note: rankNote(rank) }
}

interface JudgeModel {
  ai_search_presence?: unknown
  ai_search_score?: unknown
  local_seo?: unknown
  local_seo_score?: unknown
  commentary?: unknown
}

async function judge(
  input: CompetitiveInput,
  rankings: KeywordRanking[],
): Promise<{ ai_search_presence: string; ai_search_score: number; local_seo: string; local_seo_score: number; commentary: string } | null> {
  const rankBlock = rankings
    .map((r) => `- "${r.keyword}": ${r.rank === null ? 'not in top results' : `position ${r.rank}`}`)
    .join('\n')
  const prompt = `Assess the search visibility of ${input.siteName} (domain ${input.domain}).

Measured Google rankings (do not change these — judge around them):
${rankBlock}

On-page signals: FAQ schema ${input.signals.hasFaqSchema ? 'present' : 'absent'}; llms.txt ${input.signals.hasLlmsTxt ? 'present' : 'absent'}; LocalBusiness schema ${input.signals.hasLocalBusiness ? 'present' : 'absent'}; AI crawlers blocked: ${input.signals.aiCrawlersBlocked.join(', ') || 'none'}.

Return JSON:
{
  "ai_search_presence": "2-3 sentences on how well this site would surface in AI search (ChatGPT/Perplexity/Gemini)",
  "ai_search_score": 0-10,
  "local_seo": "2-3 sentences on local-SEO strength",
  "local_seo_score": 0-10,
  "commentary": "2-4 sentence overall assessment of competitive search visibility, addressed to the firm as 'you/your'"
}
Return only the JSON.`

  return generateMbpJson(
    prompt,
    (parsed) => {
      const p = parsed as JudgeModel
      const ai_search_presence = asStr(p.ai_search_presence)
      const local_seo = asStr(p.local_seo)
      const commentary = asStr(p.commentary)
      if (!ai_search_presence && !local_seo && !commentary) return null
      return {
        ai_search_presence,
        ai_search_score: clampScore(p.ai_search_score),
        local_seo,
        local_seo_score: clampScore(p.local_seo_score),
        commentary,
      }
    },
    900,
  )
}

export async function analyzeCompetitive(
  input: CompetitiveInput,
): Promise<CompetitiveIntelligence | null> {
  if (!serperEnabled()) return null
  const keywords = await deriveKeywords(input)
  if (!keywords?.length) return null

  const rankings: KeywordRanking[] = []
  for (const kw of keywords) {
    rankings.push(await rankCheck(kw, input.domain, input.location))
  }

  const assessment = await judge(input, rankings)

  // Sub-scores: one per measured keyword (deterministic) + the two judged ones.
  const sub_scores: Record<string, number> = {}
  rankings.forEach((r, i) => {
    sub_scores[`keyword_${i + 1}`] = rankToScore(r.rank)
  })
  sub_scores.local_seo_signals = assessment?.local_seo_score ?? 5
  sub_scores.ai_search_presence = assessment?.ai_search_score ?? 3

  const vals = Object.values(sub_scores)
  const score = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) : 0

  return {
    score,
    grade: getGrade(score),
    sub_scores,
    commentary: assessment?.commentary ?? '',
    keyword_rankings: rankings,
    ai_search_presence: assessment?.ai_search_presence ?? '',
    local_seo: assessment?.local_seo ?? '',
  }
}
