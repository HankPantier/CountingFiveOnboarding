// Competitor discovery. The firm's `niches` are its CLIENT industries, not its
// own category, so we first have Claude derive competitor-discovery queries
// ("firms LIKE this one" — its own category + location), run them through
// Serper, collect the OTHER firms that rank (excluding the audited domain and
// directory/aggregator hosts), then a second LLM pass extracts structured
// competitor entities from the result titles/snippets. Requires a Serper key —
// returns null (section omitted) without one.
import { generateMbpJson } from '@/lib/mbp/generate-json'
import type { TokenContext } from '@/lib/content/token-usage'
import { serperEnabled, serperSearch, type SerperOrganicResult } from '../serper-search'
import type { CompetitorEntity, CompetitorIntelligence, DetectedNiche } from '../types'

const MAX_QUERIES = 3
const MAX_CANDIDATES = 12
const MAX_COMPETITORS = 8

// Hosts that are directories/aggregators/social — never a competitor firm's own
// site. Matched against the registrable host (www. stripped).
const DIRECTORY_HOSTS = [
  'yelp.', 'facebook.', 'linkedin.', 'indeed.', 'mapquest.', 'bbb.org', 'thumbtack.',
  'angi.', 'angieslist.', 'yellowpages.', 'manta.', 'glassdoor.', 'instagram.', 'twitter.',
  'x.com', 'youtube.', 'tiktok.', 'wikipedia.', 'reddit.', 'google.', 'expertise.', 'clutch.',
  'birdeye.', 'healthgrades.', 'zocdoc.', 'avvo.', 'nextdoor.', 'tripadvisor.', 'apple.com',
]

export interface CompetitorsInput {
  siteName: string
  domain: string
  niches: DetectedNiche[]
  location: string
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
    : []

function hostOf(link: string): string {
  try {
    return new URL(link).host.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function isDirectory(host: string): boolean {
  return DIRECTORY_HOSTS.some((d) => host.includes(d))
}

async function deriveQueries(input: CompetitorsInput, ctx?: TokenContext): Promise<string[] | null> {
  const nicheList = input.niches.map((n) => n.name).filter(Boolean).join(', ') || '(none stated)'
  const prompt = `${input.siteName} is a professional-services firm. Its client niches: ${nicheList}. Location: ${input.location || '(unknown)'}.

Return JSON: { "queries": [ up to ${MAX_QUERIES} Google searches that would surface this firm's DIRECT COMPETITORS — other firms in the SAME category (not its clients) serving the same area ] }. Example for a CPA firm in Austin: "accounting firm Austin TX". If location is unknown, omit the location term. Return only the JSON.`

  const result = await generateMbpJson<{ queries: string[] }>(
    prompt,
    (parsed) => {
      const qs = asStrArr((parsed as { queries?: unknown })?.queries).slice(0, MAX_QUERIES)
      return qs.length ? { queries: qs } : null
    },
    400,
    ctx,
  )
  return result?.queries ?? null
}

async function gatherCandidates(queries: string[], input: CompetitorsInput): Promise<SerperOrganicResult[]> {
  const seen = new Set<string>()
  const out: SerperOrganicResult[] = []
  for (const q of queries) {
    const results = await serperSearch(q, { location: input.location || undefined })
    if (!results) continue
    for (const r of results) {
      const host = hostOf(r.link)
      if (!host || host === input.domain || isDirectory(host) || seen.has(host)) continue
      seen.add(host)
      out.push(r)
      if (out.length >= MAX_CANDIDATES) return out
    }
  }
  return out
}

function validateCompetitors(parsed: unknown): { competitors: CompetitorEntity[] } | null {
  const raw = (parsed as { competitors?: unknown })?.competitors
  if (!Array.isArray(raw)) return null
  const competitors = raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      name: asStr(c.name),
      location: asStr(c.location),
      size: asStr(c.size),
      nicheClaim: asStr(c.nicheClaim),
      positioningNotes: asStr(c.positioningNotes),
    }))
    .filter((c) => c.name)
    .slice(0, MAX_COMPETITORS)
  return competitors.length ? { competitors } : null
}

async function extractCompetitors(
  input: CompetitorsInput,
  candidates: SerperOrganicResult[],
  ctx?: TokenContext,
): Promise<CompetitorEntity[] | null> {
  const block = candidates
    .map((c, i) => `${i + 1}. ${c.title}\n   ${hostOf(c.link)}\n   ${c.snippet}`)
    .join('\n')

  const prompt = `These are Google results for firms competing with ${input.siteName} (domain ${input.domain})${input.location ? ` in ${input.location}` : ''}:

${block}

Extract the genuine competitor FIRMS (exclude ${input.siteName} itself, directories, listicles, and non-firm pages). Return JSON:
{ "competitors": [ { "name": string, "location": string, "size": string, "nicheClaim": string, "positioningNotes": string } ] }
Up to ${MAX_COMPETITORS}. Use "" for any field you can't infer from the snippet — do NOT invent. "nicheClaim" = the specialty/industry they emphasize; "positioningNotes" = how they position themselves. Return only the JSON.`

  const result = await generateMbpJson<{ competitors: CompetitorEntity[] }>(
    prompt,
    validateCompetitors,
    1500,
    ctx,
  )
  return result?.competitors ?? null
}

export async function analyzeCompetitors(
  input: CompetitorsInput,
  ctx?: TokenContext,
): Promise<CompetitorIntelligence | null> {
  if (!serperEnabled()) return null
  const queries = await deriveQueries(input, ctx)
  if (!queries?.length) return null
  const candidates = await gatherCandidates(queries, input)
  if (!candidates.length) return null
  const competitors = await extractCompetitors(input, candidates, ctx)
  if (!competitors?.length) return null
  return { competitors }
}
