// Social & Local Presence — quality assessment of a firm's off-site channels.
// GBP is sourced authoritatively from the Places API when a key is present, else
// discovered via Serper; LinkedIn (required) and the bonus channels (Instagram,
// Facebook, X) are assessed for follower/activity/page-type via one capped Serper
// query + one small AI synthesis. Best-effort throughout (mirrors the rest of the
// intelligence layer): every rung degrades to the next and the module never
// throws. Feeds the MBP and the report's Recommended Next Steps; never scored.
import { generateMbpJson } from '@/lib/mbp/generate-json'
import { GENERATION_PROVIDER_OPTIONS, PUBLISHED_CONTENT_MODEL } from '@/lib/content/generation-tuning'
import type { TokenContext } from '@/lib/content/token-usage'
import { classifyPlatform, GBP_URL_RE } from '../social-hosts'
import { lookupPlace, placesEnabled } from '../places-lookup'
import { serperEnabled, serperSearch } from '../serper-search'
import type {
  PlaceDetails,
  ProfileStatus,
  SocialPlatform,
  SocialPresenceReport,
  SocialProfileAssessment,
  SocialProfileMetrics,
  Usefulness,
} from '../types'

export interface SocialPresenceInput {
  siteName: string
  domain: string
  location: string
  socialLinks: string[]
  addresses: string[]
  onSiteNiches: string[]
}

// LinkedIn + GBP are required; these three are the bonus channels, assessed only
// when the site links them.
const BONUS_PLATFORMS: SocialPlatform[] = ['instagram', 'facebook', 'x']

const PLATFORM_QUERY_TERM: Partial<Record<SocialPlatform, string>> = {
  linkedin: 'linkedin',
  instagram: 'instagram',
  facebook: 'facebook',
  x: 'twitter',
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const asNum = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null)

export async function buildSocialPresence(
  input: SocialPresenceInput,
  ctx?: TokenContext,
): Promise<SocialPresenceReport | null> {
  const classified = classifyLinks(input.socialLinks)

  const gbp = await assessGbp(input, classified.get('google_business') ?? null)
  const others = await assessOtherPlatforms(input, classified, ctx)

  const profiles = [gbp, ...others]
  const hasGbp = gbp.status !== 'not_found'
  const linkedin = profiles.find((p) => p.platform === 'linkedin')
  const hasLinkedIn = !!linkedin && linkedin.status !== 'not_found'

  const missingRequired: SocialPlatform[] = []
  if (!hasGbp) missingRequired.push('google_business')
  if (!hasLinkedIn) missingRequired.push('linkedin')

  return {
    profiles,
    hasGbp,
    hasLinkedIn,
    missingRequired,
    summary: buildSummary(profiles, missingRequired),
  }
}

/** First harvested URL per platform. */
function classifyLinks(links: string[]): Map<SocialPlatform, string> {
  const map = new Map<SocialPlatform, string>()
  for (const url of links) {
    const platform = classifyPlatform(url)
    if (!map.has(platform)) map.set(platform, url)
  }
  return map
}

// ── Google Business Profile ─────────────────────────────────────────────────
// Places (authoritative) → Serper discovery → on-page link → not found.
async function assessGbp(
  input: SocialPresenceInput,
  onpageUrl: string | null,
): Promise<SocialProfileAssessment> {
  if (placesEnabled()) {
    const details = await lookupPlace(input.siteName, { location: input.location })
    if (details) return gbpFromPlaces(details, onpageUrl)
  }

  const searched = serperEnabled()
  if (searched) {
    const results = await serperSearch(`${input.siteName} ${input.location} google business profile`, {
      location: input.location || undefined,
    })
    const mapsUrl = results?.map((r) => r.link).find((l) => GBP_URL_RE.test(l)) ?? null
    if (mapsUrl) {
      return baseProfile('google_business', mapsUrl, 'unknown', 'low', 'serper',
        'Listing found in search — verify it is claimed and complete (hours, categories, photos, and a steady flow of reviews).')
    }
  }

  if (onpageUrl) {
    return baseProfile('google_business', onpageUrl, 'unknown', 'low', 'onpage',
      'Listing is linked from the site — verify it is claimed and every field (hours, categories, photos, reviews) is complete.')
  }

  return baseProfile('google_business', null, 'not_found', 'low', searched ? 'serper' : 'onpage',
    'No Google Business Profile found. Claiming and optimizing one is the highest-impact move for local map-pack visibility.')
}

function gbpFromPlaces(details: PlaceDetails, onpageUrl: string | null): SocialProfileAssessment {
  const metrics: SocialProfileMetrics = {
    rating: details.rating,
    reviewCount: details.reviewCount,
    categories: details.categories,
    hoursListed: details.hoursListed,
  }
  const status: ProfileStatus = details.businessStatus === 'CLOSED_PERMANENTLY' ? 'dormant' : 'active'

  const gaps: string[] = []
  if (typeof details.reviewCount === 'number' && details.reviewCount < 10) gaps.push('grow reviews')
  if (typeof details.rating === 'number' && details.rating < 4.0) gaps.push('improve rating')
  if (!details.hoursListed) gaps.push('add business hours')
  if (!details.categories.length) gaps.push('set categories')

  return {
    platform: 'google_business',
    url: details.mapsUri ?? onpageUrl,
    status,
    metrics,
    usefulness: gbpUsefulness(details.rating, details.reviewCount),
    roomForImprovement: gaps.length
      ? `Profile is live — next: ${gaps.join(', ')}.`
      : 'Profile is strong — maintain a steady flow of fresh reviews and posts.',
    source: 'places_api',
  }
}

function gbpUsefulness(rating: number | null, reviewCount: number | null): Usefulness {
  const reviews = reviewCount ?? 0
  const stars = rating ?? 0
  if (reviews >= 25 && stars >= 4.3) return 'high'
  if (reviews >= 10) return 'medium'
  return 'low'
}

// ── LinkedIn (required) + bonus channels ────────────────────────────────────
async function assessOtherPlatforms(
  input: SocialPresenceInput,
  classified: Map<SocialPlatform, string>,
  ctx?: TokenContext,
): Promise<SocialProfileAssessment[]> {
  const present = BONUS_PLATFORMS.filter((p) => classified.has(p))
  const targets: Array<{ platform: SocialPlatform; url: string | null }> = [
    { platform: 'linkedin', url: classified.get('linkedin') ?? null },
    ...present.map((p) => ({ platform: p, url: classified.get(p) ?? null })),
  ]

  const enriched = await enrichViaAI(input, targets, ctx)
  if (enriched) return enriched

  return targets.map((t) => baselineAssessment(t.platform, t.url))
}

// One capped Serper query + one small AI synthesis to pull follower/activity/
// page-type for the LinkedIn + bonus channels. Returns null (→ deterministic
// baseline) without a Serper key, on empty results, or on AI failure.
async function enrichViaAI(
  input: SocialPresenceInput,
  targets: Array<{ platform: SocialPlatform; url: string | null }>,
  ctx?: TokenContext,
): Promise<SocialProfileAssessment[] | null> {
  if (!serperEnabled()) return null
  const terms = targets.map((t) => PLATFORM_QUERY_TERM[t.platform]).filter(Boolean).join(' OR ')
  if (!terms) return null

  const loc = input.location ? ` ${input.location}` : ''
  const results = await serperSearch(`"${input.siteName}"${loc} ${terms} followers`, {
    location: input.location || undefined,
  })
  if (!results || !results.length) return null

  const snippets = results
    .slice(0, 10)
    .map((r) => `- ${r.title} — ${r.link}\n  ${r.snippet}`)
    .join('\n')
  const known = targets
    .map((t) => `- ${t.platform}: ${t.url ?? '(no link found on site)'}`)
    .join('\n')

  const prompt = `You are assessing the social-media presence of "${input.siteName}" (${input.domain}${input.location ? `, ${input.location}` : ''}) from web-search results. Use ONLY what the results support — do not invent follower counts or activity.

Channels to assess (with any URL already found on the firm's site):
${known}

For EACH channel above return an object. Return JSON:
{ "profiles": [ {
  "platform": "linkedin|instagram|facebook|x",
  "url": string (the profile URL if you can identify one, else the site-found URL, else ""),
  "status": "active|dormant|not_found|unknown",
  "followerCount": number,
  "lastActivity": "e.g. 'posted last week' — omit if unknown",
  "pageType": "company|personal|unknown" (LinkedIn only),
  "usefulness": "low|medium|high",
  "roomForImprovement": "1 short, specific, actionable sentence"
} ] }
Rules: "not_found" only when no profile exists at all. "dormant" when a profile exists but shows no recent activity. Omit numeric fields you cannot support. Return only the JSON.

SEARCH RESULTS:
${snippets}`

  const wantPlatforms = new Set(targets.map((t) => t.platform))
  const validated = await generateMbpJson<SocialProfileAssessment[]>(
    prompt,
    (parsed) => validateAiProfiles(parsed, wantPlatforms),
    1500,
    ctx,
    { model: PUBLISHED_CONTENT_MODEL, providerOptions: GENERATION_PROVIDER_OPTIONS },
  )
  if (!validated) return null

  // Ensure every required target is represented (fall back to baseline for any
  // the model dropped) so LinkedIn always appears in the report.
  const byPlatform = new Map(validated.map((p) => [p.platform, p]))
  return targets.map((t) => byPlatform.get(t.platform) ?? baselineAssessment(t.platform, t.url))
}

function validateAiProfiles(
  parsed: unknown,
  want: Set<SocialPlatform>,
): SocialProfileAssessment[] | null {
  if (!parsed || typeof parsed !== 'object') return null
  const arr = (parsed as { profiles?: unknown }).profiles
  if (!Array.isArray(arr)) return null

  const out: SocialProfileAssessment[] = []
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const platform = asStr(r.platform).toLowerCase() as SocialPlatform
    if (!want.has(platform)) continue

    const metrics: SocialProfileMetrics = {}
    const followers = asNum(r.followerCount)
    if (followers !== null) metrics.followerCount = followers
    const lastActivity = asStr(r.lastActivity)
    if (lastActivity) metrics.lastActivity = lastActivity
    const pageType = asStr(r.pageType).toLowerCase()
    if (pageType === 'company' || pageType === 'personal') metrics.pageType = pageType

    out.push({
      platform,
      url: asStr(r.url) || null,
      status: coerceStatus(r.status),
      metrics,
      usefulness: coerceUsefulness(r.usefulness),
      roomForImprovement: asStr(r.roomForImprovement),
      source: 'ai',
    })
  }
  return out.length ? out : null
}

function coerceStatus(v: unknown): ProfileStatus {
  const s = asStr(v).toLowerCase()
  return s === 'active' || s === 'dormant' || s === 'not_found' ? s : 'unknown'
}

function coerceUsefulness(v: unknown): Usefulness {
  const s = asStr(v).toLowerCase()
  return s === 'high' || s === 'medium' ? s : 'low'
}

// Deterministic assessment when no AI signal is available: a linked profile is
// "unknown" quality (needs manual review); a missing required channel is
// "not_found".
function baselineAssessment(platform: SocialPlatform, url: string | null): SocialProfileAssessment {
  if (url) {
    return baseProfile(platform, url, 'unknown', 'low', 'onpage',
      'Profile found but its activity and quality could not be assessed automatically — review it manually.')
  }
  const label = platform === 'linkedin' ? 'LinkedIn company page' : `${platform} profile`
  return baseProfile(platform, null, 'not_found', 'low', 'onpage',
    `No ${label} was found — establishing one expands reach and credibility.`)
}

function baseProfile(
  platform: SocialPlatform,
  url: string | null,
  status: ProfileStatus,
  usefulness: Usefulness,
  source: SocialProfileAssessment['source'],
  roomForImprovement: string,
): SocialProfileAssessment {
  return { platform, url, status, metrics: {}, usefulness, roomForImprovement, source }
}

function buildSummary(profiles: SocialProfileAssessment[], missingRequired: SocialPlatform[]): string {
  const found = profiles.filter((p) => p.status !== 'not_found').length
  const parts = [`${found} of ${profiles.length} assessed channels are present.`]
  if (missingRequired.length) {
    const labels = missingRequired.map((p) => (p === 'google_business' ? 'Google Business Profile' : 'LinkedIn'))
    parts.push(`Missing: ${labels.join(' and ')}.`)
  }
  return parts.join(' ')
}
