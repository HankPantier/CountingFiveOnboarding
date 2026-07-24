// Team Social Footprint & Niche-Expertise — a per-person parallel to the
// business Social & Local Presence pass (social-presence.ts). It scrapes the
// firm's team/about pages for a grounded roster, assesses each member's off-site
// social footprint (LinkedIn + other profiles) via one capped Serper query per
// person, and maps each member's certifications/expertise to untapped
// niche-content opportunities. Best-effort throughout (mirrors the rest of the
// intelligence layer): every rung degrades to the next and the module never
// throws. Feeds the MBP team roster + content gaps; never scored.
import * as cheerio from 'cheerio'
import { generateMbpJson } from '@/lib/mbp/generate-json'
import { OUTLINE_PROVIDER_OPTIONS, PUBLISHED_CONTENT_MODEL } from '@/lib/content/generation-tuning'
import type { TokenContext } from '@/lib/content/token-usage'
import { safeGet, normalizeUrl, sameDomain } from '../crawl'
import { findTeamPages, looksLikeTeamPageUrl } from '@/lib/team-photos/scrape-headshots'
import { classifyPlatform, isSocialUrl } from '../social-hosts'
import { serperEnabled, serperSearch } from '../serper-search'
import type {
  FootprintStrength,
  PersonnelProfile,
  ProfileStatus,
  SocialPlatform,
  SocialProfileAssessment,
  SocialProfileMetrics,
  TeamMemberSocial,
  TeamSocialReport,
  Usefulness,
} from '../types'

export interface TeamSocialInput {
  siteName: string
  domain: string
  /** Fetchable site URL used to scrape the team/about pages. */
  websiteUrl: string
  location: string
  onSiteNiches: string[]
  /** Names already surfaced by the digital-intelligence brief, merged into the
   * scraped roster so a member the site buries is still assessed. */
  personnelHint?: PersonnelProfile[]
  /** URLs the audit already crawled (page_analysis_summary). Team-like ones are
   * scraped even when the homepage doesn't link them with a recognizable
   * anchor — the robust discovery path that survives odd site navigation. */
  knownUrls?: string[]
}

// Assessing every member of a large firm would multiply Serper cost without
// adding signal; cap the roster and record how many were dropped (no silent
// truncation — surfaced in the report).
const MAX_MEMBERS = 8
const MAX_TEAM_PAGES = 4
// Individual bio/profile pages (e.g. /team/jane-doe) linked from a team listing
// — where the richest per-person expertise usually lives.
const MAX_BIO_PAGES = 12
// Per-page and total caps on scraped roster text. Generous enough that a team
// page's roster/bios aren't truncated (a footer roster can sit ~18k chars deep),
// while still bounding the extraction prompt.
const PAGE_TEXT_CAP = 20_000
const TOTAL_TEXT_CAP = 60_000

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const asNum = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null)
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
    : []

function dedup(values: Iterable<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const t = v.trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out
}

// ── Roster scrape (fresh — works from refreshAuditIntelligence, which has no
//    stored raw HTML) ─────────────────────────────────────────────────────────
interface ScrapedRoster {
  text: string
  siteSocialLinks: string[]
  scannedPages: string[]
}

/** Readable text + harvested social links from one already-fetched page. Pure. */
export function extractTeamText(html: string, pageUrl: string): { text: string; socialLinks: string[] } {
  const $ = cheerio.load(html)
  $('script, style, noscript, template').remove()
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, PAGE_TEXT_CAP)

  const socialLinks: string[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    const full = normalizeUrl(href, pageUrl)
    if (full && isSocialUrl(full)) socialLinks.push(full)
  })
  return { text, socialLinks }
}

// Paths that are children of a team page but are not a person's bio.
const SKIP_BIO_PATH_RE =
  /\.(pdf|jpe?g|png|gif|svg|webp|docx?|xlsx?)$|\/(contact|privacy|terms|search|category|categories|tag|tags|page|blog|news|events?|services?|resources?)(\/|$)/i

/** Individual bio/profile pages linked from a team listing: same-domain links
 * exactly one path segment deeper than the team page (e.g. /who-we-are →
 * /who-we-are/jane-doe). Pure. */
export function findBioPages(html: string, teamPageUrl: string): string[] {
  let base: URL
  try {
    base = new URL(teamPageUrl)
  } catch {
    return []
  }
  const basePath = base.pathname.replace(/\/+$/, '')
  if (!basePath) return [] // a homepage/root has no meaningful bio sub-tree

  const $ = cheerio.load(html)
  const out: string[] = []
  const seen = new Set<string>()
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
    const full = normalizeUrl(href, teamPageUrl)
    if (!full || !sameDomain(full, base.host)) return
    let path: string
    try {
      path = new URL(full).pathname.replace(/\/+$/, '')
    } catch {
      return
    }
    if (!path.startsWith(`${basePath}/`)) return
    const rest = path.slice(basePath.length + 1)
    if (!rest || rest.includes('/')) return // exactly one segment deeper
    if (SKIP_BIO_PATH_RE.test(path)) return
    if (seen.has(full)) return
    seen.add(full)
    out.push(full)
  })
  return out
}

function isHtml200(res: Awaited<ReturnType<typeof safeGet>>): boolean {
  return !!res && res.status === 200 && res.contentType.includes('text/html')
}

/** Fetch the homepage, discover team/about pages (from homepage links AND the
 * audit's already-crawled inventory), and collect their text + social links.
 * SSRF-guarded via safeGet on every request. */
async function scrapeTeamRoster(websiteUrl: string, knownUrls: string[] = []): Promise<ScrapedRoster> {
  const scannedPages: string[] = []
  const parts: string[] = []
  const socialLinks: string[] = []
  const seenPage = new Set<string>()

  const absorb = (finalUrl: string, html: string) => {
    if (seenPage.has(finalUrl)) return
    seenPage.add(finalUrl)
    scannedPages.push(finalUrl)
    const { text, socialLinks: links } = extractTeamText(html, finalUrl)
    if (text) parts.push(`### ${finalUrl}\n${text}`)
    socialLinks.push(...links)
  }

  let baseHost = ''
  try {
    baseHost = new URL(websiteUrl).host
  } catch {
    // websiteUrl unparsable — same-domain filtering below just won't apply.
  }

  // Homepage-linked team pages take priority (Set preserves insertion order),
  // then same-domain team-like URLs from the crawl inventory as a fallback for
  // sites whose nav doesn't surface the roster with a recognizable anchor.
  const candidates = new Set<string>()
  const home = await safeGet(websiteUrl)
  if (isHtml200(home)) {
    absorb(home!.finalUrl, home!.body)
    try {
      baseHost = new URL(home!.finalUrl).host
    } catch {
      // keep the input-derived host
    }
    for (const u of findTeamPages(home!.body, home!.finalUrl)) candidates.add(u)
  }
  for (const u of knownUrls) {
    if (looksLikeTeamPageUrl(u) && (!baseHost || sameDomain(u, baseHost))) candidates.add(u)
  }

  const targets = [...candidates].filter((u) => !seenPage.has(u)).slice(0, MAX_TEAM_PAGES)
  const bioCandidates = new Set<string>()
  for (const url of targets) {
    const res = await safeGet(url)
    if (!isHtml200(res)) continue
    absorb(res!.finalUrl, res!.body)
    for (const b of findBioPages(res!.body, res!.finalUrl)) bioCandidates.add(b)
  }

  // Follow individual bio pages — where per-person expertise usually lives.
  const bioTargets = [...bioCandidates].filter((u) => !seenPage.has(u)).slice(0, MAX_BIO_PAGES)
  for (const url of bioTargets) {
    const res = await safeGet(url)
    if (!isHtml200(res)) continue
    absorb(res!.finalUrl, res!.body)
  }

  return {
    text: parts.join('\n\n').slice(0, TOTAL_TEXT_CAP),
    siteSocialLinks: dedup(socialLinks),
    scannedPages,
  }
}

// ── Roster extraction (AI over scraped team text) ───────────────────────────
interface RosterMember {
  name: string
  title: string
  certifications: string[]
  specializations: string[]
  bio: string
}

function validateRoster(parsed: unknown): RosterMember[] | null {
  if (!parsed || typeof parsed !== 'object') return null
  const arr = (parsed as { members?: unknown }).members
  if (!Array.isArray(arr)) return null
  const out: RosterMember[] = []
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const name = asStr(r.name)
    if (!name) continue
    out.push({
      name,
      title: asStr(r.title),
      certifications: asStrArr(r.certifications),
      specializations: asStrArr(r.specializations),
      bio: asStr(r.bio),
    })
  }
  return out.length ? out : null
}

async function extractRoster(
  text: string,
  input: TeamSocialInput,
  ctx?: TokenContext,
): Promise<RosterMember[]> {
  if (!text) return []
  const prompt = `You are extracting the team roster of "${input.siteName}" (${input.domain}) from its scraped team/about and individual bio pages. Return ONLY people who work at the firm — skip clients, testimonial authors, vendors, and generic names. Use ONLY what the text supports; never invent credentials or expertise.

For EACH person, capture as much detail as the text provides — this feeds a niche-content analysis, so specializations and industries served matter most:
- certifications: every professional credential/license shown (CPA, EA, CFP, CVA, ABV, PFS, MBA, JD, etc.)
- specializations: ALL stated areas of expertise, practice areas, service specialties, AND industries/client types served (e.g. "construction accounting", "estate planning", "restaurant clients", "oil & gas", "business valuation") — be thorough and specific
- bio: the person's full bio/summary as written (not just 1-2 sentences), including experience, education, and notable work if present

Return JSON:
{ "members": [ {
  "name": string,
  "title": string,
  "certifications": [string],
  "specializations": [string],
  "bio": string
} ] }
Omit fields you cannot support. Return only the JSON.

TEAM & BIO PAGE TEXT:
${text}`

  const members =
    (await generateMbpJson<RosterMember[]>(prompt, validateRoster, 6000, ctx, {
      model: PUBLISHED_CONTENT_MODEL,
      providerOptions: OUTLINE_PROVIDER_OPTIONS,
    })) ?? []

  return mergeHint(members, input.personnelHint)
}

/** Add hint personnel the scraped roster missed, keyed by lowercased name. */
function mergeHint(members: RosterMember[], hint?: PersonnelProfile[]): RosterMember[] {
  if (!hint?.length) return members
  const byName = new Map(members.map((m) => [m.name.toLowerCase(), m]))
  for (const p of hint) {
    if (!p.name || byName.has(p.name.toLowerCase())) continue
    const member: RosterMember = {
      name: p.name,
      title: p.role ?? '',
      certifications: [],
      specializations: [],
      bio: p.notes ?? '',
    }
    members.push(member)
    byName.set(p.name.toLowerCase(), member)
  }
  return members
}

// ── Per-member external discovery (Serper) ──────────────────────────────────
const cityFrom = (location: string): string => location.split(',')[0]?.trim() ?? ''

// Up to two targeted queries per member: firm-scoped first (most precise), then
// a broader location + credential + domain query only if the first is empty.
// Bounded by MAX_MEMBERS, so ≤ 2·MAX_MEMBERS Serper calls.
async function searchMembers(
  members: RosterMember[],
  input: TeamSocialInput,
): Promise<Map<string, string>> {
  const snippets = new Map<string, string>()
  if (!serperEnabled()) return snippets
  const city = cityFrom(input.location)
  for (const m of members) {
    const cert = m.certifications[0] ?? ''
    const queries = [
      `"${m.name}" "${input.siteName}" (linkedin OR "linkedin.com/in")`,
      `"${m.name}" ${[city, cert].filter(Boolean).join(' ')} (linkedin OR "${input.domain}")`.replace(/\s+/g, ' ').trim(),
    ]
    for (const q of queries) {
      const results = await serperSearch(q, { location: input.location || undefined })
      if (results?.length) {
        snippets.set(
          m.name,
          results.slice(0, 6).map((r) => `- ${r.title} — ${r.link}\n  ${r.snippet}`).join('\n'),
        )
        break
      }
    }
  }
  return snippets
}

function coerceStatus(v: unknown): ProfileStatus {
  const s = asStr(v).toLowerCase()
  return s === 'active' || s === 'dormant' || s === 'not_found' ? s : 'unknown'
}
function coerceUsefulness(v: unknown): Usefulness {
  const s = asStr(v).toLowerCase()
  return s === 'high' || s === 'medium' ? s : 'low'
}
function coerceFootprint(v: unknown): FootprintStrength {
  const s = asStr(v).toLowerCase()
  return s === 'strong' || s === 'moderate' ? s : 'minimal'
}

function validateProfiles(v: unknown): SocialProfileAssessment[] {
  if (!Array.isArray(v)) return []
  const out: SocialProfileAssessment[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const url = asStr(r.url) || null
    // A platform is classified from the URL when possible so it never drifts
    // from the shared host list; falls back to the model's own label.
    const platform: SocialPlatform = url
      ? classifyPlatform(url)
      : ((asStr(r.platform).toLowerCase() || 'other') as SocialPlatform)
    const metrics: SocialProfileMetrics = {}
    const followers = asNum(r.followerCount)
    if (followers !== null) metrics.followerCount = followers
    const lastActivity = asStr(r.lastActivity)
    if (lastActivity) metrics.lastActivity = lastActivity
    const pageType = asStr(r.pageType).toLowerCase()
    if (pageType === 'personal' || pageType === 'company') metrics.pageType = pageType
    out.push({
      platform,
      url,
      status: coerceStatus(r.status),
      metrics,
      usefulness: coerceUsefulness(r.usefulness),
      roomForImprovement: asStr(r.roomForImprovement),
      source: 'ai',
    })
  }
  return out
}

// ── Pass A: niche-expertise mapping (ALWAYS runs — the core deliverable) ─────
// Derives untapped niche-content opportunities purely from each member's
// certifications/expertise vs. the niches the site already markets. Independent
// of social discovery, so it survives even when no profiles are found. Uses the
// low-effort structural profile + a retry so it does not truncate/drop.
interface NicheMapping {
  perMember: Record<string, string[]>
  team: string[]
}

function validateNicheMapping(parsed: unknown): NicheMapping | null {
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  const perMember: Record<string, string[]> = {}
  for (const raw of Array.isArray(p.members) ? p.members : []) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const name = asStr(r.name)
    const niches = asStrArr(r.nicheOpportunities)
    if (name && niches.length) perMember[name] = niches
  }
  const team = asStrArr(p.teamNicheOpportunities)
  if (!Object.keys(perMember).length && !team.length) return null
  return { perMember, team }
}

const hasNicheContent = (m: NicheMapping): boolean =>
  m.team.length > 0 || Object.keys(m.perMember).length > 0

async function mapTeamNiches(
  roster: RosterMember[],
  input: TeamSocialInput,
  ctx?: TokenContext,
): Promise<NicheMapping | null> {
  const memberBlocks = roster
    .map((m) => {
      const facts = [
        m.title && `Title: ${m.title}`,
        m.certifications.length && `Certifications: ${m.certifications.join(', ')}`,
        m.specializations.length && `Expertise: ${m.specializations.join(', ')}`,
        m.bio && `Bio: ${m.bio}`,
      ]
        .filter(Boolean)
        .join('; ')
      return `- ${m.name}${facts ? ` — ${facts}` : ''}`
    })
    .join('\n')

  const prompt = `You are a niche-marketing strategist for "${input.siteName}", an accounting/advisory firm${input.location ? ` in ${input.location}` : ''}. Below is the firm's team with the certifications and expertise stated on their site.

The website currently markets these niches: ${input.onSiteNiches.join(', ') || '(none stated)'}.

Using each person's certifications and expertise, identify UNTAPPED niche-content opportunities — specific industries, client types, or service specializations the firm is credentialed to serve but does NOT currently surface on its site. Be concrete and tie each to the credentials shown (e.g. a CVA → business-valuation content for M&A/divorce; construction-accounting expertise → contractor WIP/percentage-of-completion tax content; a CFP → retirement/estate planning for a named client type). Do NOT restate niches already on the site, and do NOT invent credentials that are not listed. If a person's credential is generic (e.g. CPA with no stated specialty), you may leave their nicheOpportunities empty.

Return JSON:
{
  "members": [ { "name": string, "nicheOpportunities": [ "specific untapped niche-content idea tied to this person's credentials" ] } ],
  "teamNicheOpportunities": [ "3-6 highest-value niche themes the team's combined expertise unlocks that the site is missing" ]
}
Return only the JSON.

TEAM:
${memberBlocks}`

  return generateMbpJson<NicheMapping>(prompt, validateNicheMapping, 4000, ctx, {
    model: PUBLISHED_CONTENT_MODEL,
    providerOptions: OUTLINE_PROVIDER_OPTIONS,
    attempts: 2,
    accept: hasNicheContent,
  })
}

// ── Pass B: social-footprint assessment (best-effort, only members with signal)
interface SocialAssessment {
  socialProfiles: SocialProfileAssessment[]
  footprint: FootprintStrength
  roomForImprovement: string
}

function validateSocialMap(parsed: unknown): Map<string, SocialAssessment> | null {
  if (!parsed || typeof parsed !== 'object') return null
  const arr = (parsed as { members?: unknown }).members
  if (!Array.isArray(arr)) return null
  const map = new Map<string, SocialAssessment>()
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const name = asStr(r.name)
    if (!name) continue
    map.set(name, {
      socialProfiles: validateProfiles(r.socialProfiles),
      footprint: coerceFootprint(r.footprint),
      roomForImprovement: asStr(r.roomForImprovement),
    })
  }
  return map.size ? map : null
}

async function assessTeamSocial(
  roster: RosterMember[],
  snippets: Map<string, string>,
  input: TeamSocialInput,
  ctx?: TokenContext,
): Promise<Map<string, SocialAssessment>> {
  // Only assess members Serper actually surfaced something for — members with no
  // signal are honestly "minimal" and don't need an AI round-trip.
  const withSignal = roster.filter((m) => snippets.has(m.name))
  if (!withSignal.length) return new Map()

  const memberBlocks = withSignal
    .map((m) => `## ${m.name}${m.title ? ` (${m.title})` : ''}\nSEARCH RESULTS:\n${snippets.get(m.name)}`)
    .join('\n\n')

  const prompt = `You are assessing the off-site professional social footprint of team members at "${input.siteName}" (${input.domain}${input.location ? `, ${input.location}` : ''}) from web-search results. Use ONLY what the results support — do not invent profiles, URLs, or follower counts. A result is only THIS person if the name AND firm/location plausibly match; otherwise treat as not found.

Return JSON:
{
  "members": [ {
    "name": string,
    "socialProfiles": [ {
      "platform": "linkedin|instagram|facebook|x|other",
      "url": string,
      "status": "active|dormant|not_found|unknown",
      "followerCount": number,        // omit if unknown
      "lastActivity": string,         // omit if unknown
      "pageType": "personal|company", // omit if unknown
      "usefulness": "low|medium|high",
      "roomForImprovement": "1 short, specific, actionable sentence"
    } ],
    "footprint": "minimal|moderate|strong",
    "roomForImprovement": "1 sentence on strengthening this person's footprint"
  } ]
}
Omit fields you cannot support. Return only the JSON.

TEAM MEMBERS:
${memberBlocks}`

  const result = await generateMbpJson<Map<string, SocialAssessment>>(prompt, validateSocialMap, 6000, ctx, {
    model: PUBLISHED_CONTENT_MODEL,
    providerOptions: OUTLINE_PROVIDER_OPTIONS,
    attempts: 2,
  })
  return result ?? new Map()
}

// ── External enrichment: pull credentials/expertise the firm's own site omits ─
// Reuses the Serper snippets already fetched for the social pass to extract each
// member's professional certifications, specializations, and industries served
// from the wider web (LinkedIn, directories, press), then merges them into the
// roster BEFORE niche mapping. Strictly additive and match-gated — critical for
// firms whose site lists only name + title.
interface ExternalDetail {
  certifications: string[]
  specializations: string[]
  bioAddendum: string
}

function validateExternalMap(parsed: unknown): Map<string, ExternalDetail> | null {
  if (!parsed || typeof parsed !== 'object') return null
  const arr = (parsed as { members?: unknown }).members
  if (!Array.isArray(arr)) return null
  const map = new Map<string, ExternalDetail>()
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const name = asStr(r.name)
    if (!name) continue
    map.set(name, {
      certifications: asStrArr(r.certifications),
      specializations: asStrArr(r.specializations),
      bioAddendum: asStr(r.bioAddendum),
    })
  }
  return map.size ? map : null
}

// Mutates `roster` in place, merging match-gated external detail into each
// member. No-op without search signal or on AI failure.
async function enrichRosterExternal(
  roster: RosterMember[],
  snippets: Map<string, string>,
  input: TeamSocialInput,
  ctx?: TokenContext,
): Promise<void> {
  const withSignal = roster.filter((m) => snippets.has(m.name))
  if (!withSignal.length) return

  const memberBlocks = withSignal
    .map((m) => {
      const known = [
        m.title && `Title: ${m.title}`,
        m.certifications.length && `Known certifications: ${m.certifications.join(', ')}`,
      ]
        .filter(Boolean)
        .join('; ')
      return `## ${m.name}${known ? ` — ${known}` : ''}\nSEARCH RESULTS:\n${snippets.get(m.name)}`
    })
    .join('\n\n')

  const prompt = `You are enriching the professional profiles of team members at "${input.siteName}" (${input.domain}${input.location ? `, ${input.location}` : ''}) using web-search results, because the firm's own site lists little detail. For EACH member, extract additional professional facts the results support.

CRITICAL: attribute a fact ONLY when the result clearly refers to THIS person at THIS firm/location (name + firm or name + location + profession must match). If a result is about a different person with the same name, ignore it. Never invent credentials, specialties, or industries.

Return JSON:
{ "members": [ {
  "name": string,
  "certifications": [string],   // professional credentials NOT already listed (CPA, CVA, ABV, CFP, EA, etc.)
  "specializations": [string],  // areas of expertise, service specialties, and industries/client types served
  "bioAddendum": string         // one short sentence of external professional context, or ""
} ] }
Return members only where the results genuinely support new facts; omit the rest. Return only the JSON.

TEAM MEMBERS:
${memberBlocks}`

  const result = await generateMbpJson<Map<string, ExternalDetail>>(prompt, validateExternalMap, 5000, ctx, {
    model: PUBLISHED_CONTENT_MODEL,
    providerOptions: OUTLINE_PROVIDER_OPTIONS,
    attempts: 2,
  })
  if (!result) return

  for (const m of roster) {
    const ext = result.get(m.name)
    if (!ext) continue
    if (ext.certifications.length) m.certifications = dedup([...m.certifications, ...ext.certifications])
    if (ext.specializations.length) m.specializations = dedup([...m.specializations, ...ext.specializations])
    if (ext.bioAddendum) m.bio = m.bio ? `${m.bio} ${ext.bioAddendum}`.trim() : ext.bioAddendum
  }
}

// Sensible per-member fallback when no social profile was surfaced — honest and
// actionable, not a "the system failed" message.
function noSignalRoom(hasSocialLink: boolean): string {
  return hasSocialLink
    ? 'A social profile is linked on the site but its activity could not be verified — review it and keep it active.'
    : 'No public professional profile surfaced in search — a complete, active LinkedIn profile would build authority and referral reach.'
}

function buildSummary(members: TeamMemberSocial[], dropped: number, nicheCount: number): string {
  const withProfiles = members.filter((m) => m.socialProfiles.some((p) => p.url && p.status !== 'not_found')).length
  const parts = [
    `${members.length} team member${members.length === 1 ? '' : 's'} assessed; ${withProfiles} with a findable social footprint.`,
  ]
  if (nicheCount > 0) parts.push(`${nicheCount} untapped niche opportunit${nicheCount === 1 ? 'y' : 'ies'} surfaced from team credentials.`)
  if (dropped > 0) parts.push(`${dropped} more found but not assessed (roster cap ${MAX_MEMBERS}).`)
  return parts.join(' ')
}

export async function buildTeamSocial(
  input: TeamSocialInput,
  ctx?: TokenContext,
): Promise<TeamSocialReport | null> {
  const scraped = await scrapeTeamRoster(input.websiteUrl, input.knownUrls ?? [])
  const roster = await extractRoster(scraped.text, input, ctx)
  if (!roster.length) return null

  const dropped = Math.max(0, roster.length - MAX_MEMBERS)
  const assessed = roster.slice(0, MAX_MEMBERS)
  const hasSocialLink = scraped.siteSocialLinks.length > 0

  // Discover external signal once, reused for both enrichment and social. Enrich
  // the roster from the wider web BEFORE niche mapping so a name+title-only site
  // still yields real expertise to map. Then Pass A (niche, always) and Pass B
  // (social, best-effort, only members with signal).
  const snippets = await searchMembers(assessed, input)
  await enrichRosterExternal(assessed, snippets, input, ctx)
  const niche = await mapTeamNiches(assessed, input, ctx)
  const social = await assessTeamSocial(assessed, snippets, input, ctx)

  const members: TeamMemberSocial[] = assessed.map((m) => {
    const s = social.get(m.name)
    return {
      name: m.name,
      title: m.title || undefined,
      certifications: m.certifications,
      specializations: m.specializations,
      socialProfiles: s?.socialProfiles ?? [],
      footprint: s?.footprint ?? 'minimal',
      roomForImprovement: s?.roomForImprovement || noSignalRoom(hasSocialLink),
      nicheOpportunities: dedup(niche?.perMember[m.name] ?? []),
      source: s ? 'ai' : 'onpage',
    }
  })

  const teamNicheOpportunities = dedup(niche?.team ?? [])
  const nicheCount = teamNicheOpportunities.length + members.reduce((n, m) => n + m.nicheOpportunities.length, 0)

  return {
    members,
    teamNicheOpportunities,
    summary: buildSummary(members, dropped, nicheCount),
    membersAssessed: members.length,
    membersDropped: dropped,
  }
}
