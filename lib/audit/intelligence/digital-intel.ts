// Digital Intelligence Brief — off-site research. Runs a capped set of Serper
// web searches (reputation, personnel, associations, press), then has Claude
// synthesize personnel profiles, reputation, affiliations, content footprint,
// social presence, and the external-vs-website niche gap. Requires a Serper key
// — returns null (section omitted) without one, or when no results come back.
import { generateMbpJson } from '@/lib/mbp/generate-json'
import type { TokenContext } from '@/lib/content/token-usage'
import { serperEnabled, serperSearch, type SerperOrganicResult } from '../serper-search'
import type {
  ContentFootprintItem,
  DigitalIntelligence,
  FootprintStrength,
  PersonnelProfile,
  SocialPresenceItem,
} from '../types'

export interface DigitalIntelInput {
  siteName: string
  domain: string
  location: string
  onSiteNiches: string[]
}

// Synthesis passes before accepting the brief. Retries re-run only the model
// (Serper results are already captured), so this is cheap insurance against a
// transient miss on the niche-gap block.
const DIGITAL_INTEL_ATTEMPTS = 2

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
    : []
const asObjArr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

function asFootprint(v: unknown): FootprintStrength {
  const s = asStr(v).toLowerCase()
  return s === 'strong' || s === 'moderate' ? s : 'minimal'
}

function buildQueries(input: DigitalIntelInput): string[] {
  const firm = `"${input.siteName}"`
  const loc = input.location ? ` ${input.location}` : ''
  return [
    `${firm}${loc} reviews`,
    `${firm}${loc} owner OR partners OR team`,
    `${firm}${loc} association OR award OR press`,
    `${firm}${loc} linkedin OR facebook OR yelp`,
  ]
}

function renderResults(label: string, results: SerperOrganicResult[] | null): string {
  if (!results || !results.length) return `## ${label}\n(no results)\n`
  const lines = results
    .slice(0, 8)
    .map((r) => `- ${r.title} — ${r.link}\n  ${r.snippet}`)
    .join('\n')
  return `## ${label}\n${lines}\n`
}

function validate(parsed: unknown): DigitalIntelligence | null {
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>

  const personnel: PersonnelProfile[] = asObjArr(p.personnel).map((x) => ({
    name: asStr(x.name),
    role: asStr(x.role),
    footprint: asFootprint(x.footprint),
    linkedin: asStr(x.linkedin) || undefined,
    associations: asStrArr(x.associations),
    notes: asStr(x.notes),
  })).filter((x) => x.name)

  const rep = (p.reputation ?? {}) as Record<string, unknown>
  const reputation = {
    sentiment: asStr(rep.sentiment),
    ratings: asStrArr(rep.ratings),
    praise_themes: asStrArr(rep.praise_themes),
    concern_themes: asStrArr(rep.concern_themes),
  }

  const content_footprint: ContentFootprintItem[] = asObjArr(p.content_footprint).map((x) => ({
    type: asStr(x.type),
    title: asStr(x.title),
    source: asStr(x.source),
  })).filter((x) => x.title || x.source)

  const social_presence: SocialPresenceItem[] = asObjArr(p.social_presence).map((x) => ({
    platform: asStr(x.platform),
    status: asStr(x.status),
    detail: asStr(x.detail),
  })).filter((x) => x.platform)

  const gap = (p.niche_gap ?? {}) as Record<string, unknown>
  const niche_gap = {
    external: asStrArr(gap.external),
    on_site: asStrArr(gap.on_site),
    unleveraged: asStrArr(gap.unleveraged),
  }

  const hasAny =
    personnel.length ||
    reputation.sentiment ||
    content_footprint.length ||
    social_presence.length ||
    niche_gap.external.length ||
    niche_gap.on_site.length ||
    niche_gap.unleveraged.length
  if (!hasAny) return null

  return { personnel, reputation, affiliations: asStrArr(p.affiliations), content_footprint, social_presence, niche_gap }
}

/** The niche-gap block (external vs. on-site niche visibility) is the reason this
 * brief matters for the audit — treat a result with an empty gap as incomplete
 * so the synthesis pass is retried before we accept it. */
export function hasNicheGap(d: DigitalIntelligence): boolean {
  return (
    d.niche_gap.external.length > 0 ||
    d.niche_gap.on_site.length > 0 ||
    d.niche_gap.unleveraged.length > 0
  )
}

export async function buildDigitalIntelligence(
  input: DigitalIntelInput,
  ctx?: TokenContext,
): Promise<DigitalIntelligence | null> {
  if (!serperEnabled()) return null

  const queries = buildQueries(input)
  const labels = ['Reputation & reviews', 'Personnel', 'Associations / awards / press', 'Social & directories']
  const blocks: string[] = []
  let gotAny = false
  for (let i = 0; i < queries.length; i++) {
    const results = await serperSearch(queries[i], { location: input.location || undefined })
    if (results && results.length) gotAny = true
    blocks.push(renderResults(labels[i], results))
  }
  if (!gotAny) {
    console.warn('[digital-intel] no external search results — niche gap cannot be captured')
    return null
  }

  const prompt = `You are compiling a Digital Intelligence Brief on "${input.siteName}" (domain ${input.domain}${input.location ? `, ${input.location}` : ''}) from external web-search results. Use ONLY what the results support; do not invent. The firm's website names these niches: ${input.onSiteNiches.join(', ') || '(none)'}.

Return JSON:
{
  "personnel": [ { "name": string, "role": string, "footprint": "minimal|moderate|strong", "linkedin": string, "associations": [string], "notes": "1-2 sentences" } ],
  "reputation": { "sentiment": "Positive|Mixed|Negative|Unknown", "ratings": ["e.g. 'Yelp 5.0', 'BBB A+'"], "praise_themes": [string], "concern_themes": [string] },
  "affiliations": [ "professional associations / memberships" ],
  "content_footprint": [ { "type": "Press|Award|Article|Interview", "title": string, "source": string } ],
  "social_presence": [ { "platform": string, "status": "Active|Dormant|Not Found", "detail": "e.g. follower count" } ],
  "niche_gap": { "external": [ "niches/credibility visible OFF the website" ], "on_site": [ "niches the website claims" ], "unleveraged": [ "real credibility not surfaced on the site" ] }
}
Omit array items you cannot support. Return only the JSON.

SEARCH RESULTS:
${blocks.join('\n')}`

  // Retry the synthesis (search results are already in the prompt, so retries
  // only re-run the model) until the niche gap is populated, falling back to the
  // best partial brief if it stays empty.
  const result = await generateMbpJson<DigitalIntelligence>(prompt, validate, 4000, ctx, {
    attempts: DIGITAL_INTEL_ATTEMPTS,
    accept: hasNicheGap,
  })
  if (result && !hasNicheGap(result)) {
    console.warn(`[digital-intel] brief captured but niche gap still empty after ${DIGITAL_INTEL_ATTEMPTS} attempts`)
  }
  return result
}
