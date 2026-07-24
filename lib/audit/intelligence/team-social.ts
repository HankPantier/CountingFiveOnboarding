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
import { GENERATION_PROVIDER_OPTIONS, PUBLISHED_CONTENT_MODEL } from '@/lib/content/generation-tuning'
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
// Per-page and total caps on scraped roster text, keeping the extraction prompt
// bounded regardless of page weight.
const PAGE_TEXT_CAP = 6_000
const TOTAL_TEXT_CAP = 14_000

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
  for (const url of targets) {
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
  const prompt = `You are extracting the team roster of "${input.siteName}" (${input.domain}) from its scraped team/about page text. Return ONLY people who work at the firm — skip clients, testimonial authors, and generic names. Use ONLY what the text supports; do not invent credentials.

Return JSON:
{ "members": [ {
  "name": string,
  "title": string,
  "certifications": [string]  // e.g. "CPA", "EA", "CFP" — professional credentials/licenses,
  "specializations": [string] // practice areas / areas of expertise,
  "bio": string               // 1-2 sentences if present, else ""
} ] }
Omit fields you cannot support. Return only the JSON.

TEAM PAGE TEXT:
${text}`

  const members =
    (await generateMbpJson<RosterMember[]>(prompt, validateRoster, 2500, ctx, {
      model: PUBLISHED_CONTENT_MODEL,
      providerOptions: GENERATION_PROVIDER_OPTIONS,
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

// ── Per-member external enrichment (Serper) + AI synthesis ──────────────────
async function searchMembers(
  members: RosterMember[],
  input: TeamSocialInput,
): Promise<Map<string, string>> {
  const snippets = new Map<string, string>()
  if (!serperEnabled()) return snippets
  for (const m of members) {
    const results = await serperSearch(`"${m.name}" "${input.siteName}" linkedin OR credentials`, {
      location: input.location || undefined,
    })
    if (!results?.length) continue
    snippets.set(
      m.name,
      results
        .slice(0, 6)
        .map((r) => `- ${r.title} — ${r.link}\n  ${r.snippet}`)
        .join('\n'),
    )
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

interface Synthesis {
  members: TeamMemberSocial[]
  teamNicheOpportunities: string[]
}

function validateSynthesis(roster: RosterMember[]) {
  const byName = new Map(roster.map((m) => [m.name.toLowerCase(), m]))
  return (parsed: unknown): Synthesis | null => {
    if (!parsed || typeof parsed !== 'object') return null
    const p = parsed as Record<string, unknown>
    const arr = Array.isArray(p.members) ? p.members : null
    if (!arr) return null
    const members: TeamMemberSocial[] = []
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      const name = asStr(r.name)
      if (!name) continue
      const base = byName.get(name.toLowerCase())
      members.push({
        name,
        title: asStr(r.title) || base?.title || undefined,
        certifications: dedup([...(base?.certifications ?? []), ...asStrArr(r.certifications)]),
        specializations: dedup([...(base?.specializations ?? []), ...asStrArr(r.specializations)]),
        socialProfiles: validateProfiles(r.socialProfiles),
        footprint: coerceFootprint(r.footprint),
        roomForImprovement: asStr(r.roomForImprovement),
        nicheOpportunities: asStrArr(r.nicheOpportunities),
        source: 'ai',
      })
    }
    if (!members.length) return null
    return { members, teamNicheOpportunities: asStrArr(p.teamNicheOpportunities) }
  }
}

async function synthesize(
  roster: RosterMember[],
  snippets: Map<string, string>,
  siteSocialLinks: string[],
  input: TeamSocialInput,
  ctx?: TokenContext,
): Promise<Synthesis | null> {
  const memberBlocks = roster
    .map((m) => {
      const facts = [
        m.title && `Title: ${m.title}`,
        m.certifications.length && `Certifications: ${m.certifications.join(', ')}`,
        m.specializations.length && `Specializations: ${m.specializations.join(', ')}`,
        m.bio && `Bio: ${m.bio}`,
      ]
        .filter(Boolean)
        .join('\n  ')
      const search = snippets.get(m.name)
      return `## ${m.name}\n  ${facts || '(no on-page details)'}\n  SEARCH RESULTS:\n${search ? search : '  (none)'}`
    })
    .join('\n\n')

  const prompt = `You are assessing the individual team members of "${input.siteName}" (${input.domain}${input.location ? `, ${input.location}` : ''}). For EACH member below, assess their off-site professional social footprint and map their certifications/expertise to untapped niche-content opportunities for the firm. Use ONLY what the details and search results support — do not invent profiles, follower counts, or credentials.

The firm's website currently names these niches: ${input.onSiteNiches.join(', ') || '(none)'}.
Social links found anywhere on the site: ${siteSocialLinks.join(', ') || '(none)'}.

Return JSON:
{
  "members": [ {
    "name": string,
    "title": string,
    "certifications": [string],
    "specializations": [string],
    "socialProfiles": [ {
      "platform": "linkedin|instagram|facebook|x|other",
      "url": string,                         // the profile URL if identifiable, else ""
      "status": "active|dormant|not_found|unknown",
      "followerCount": number,               // omit if unknown
      "lastActivity": string,                // e.g. "posted last week" — omit if unknown
      "pageType": "personal|company",        // omit if unknown
      "usefulness": "low|medium|high",
      "roomForImprovement": "1 short, specific, actionable sentence"
    } ],
    "footprint": "minimal|moderate|strong", // overall strength of THIS person's external presence
    "roomForImprovement": "1 sentence on how this person could strengthen their footprint",
    "nicheOpportunities": [ "untapped niche-content the firm could publish given this person's certs/expertise" ]
  } ],
  "teamNicheOpportunities": [ "highest-value niche-content themes the whole team's combined expertise unlocks that the site does not yet cover" ]
}
Rules: use "not_found" only when no profile exists at all; "dormant" when a profile exists but shows no recent activity. Omit fields you cannot support. Return only the JSON.

TEAM MEMBERS:
${memberBlocks}`

  return generateMbpJson<Synthesis>(prompt, validateSynthesis(roster), 5000, ctx, {
    model: PUBLISHED_CONTENT_MODEL,
    providerOptions: GENERATION_PROVIDER_OPTIONS,
  })
}

// Deterministic fallback when the synthesis fails entirely: still surface the
// roster with any on-site social links classified, so the section is never empty
// when a roster was found.
function baselineMembers(roster: RosterMember[]): TeamMemberSocial[] {
  return roster.map((m) => ({
    name: m.name,
    title: m.title || undefined,
    certifications: m.certifications,
    specializations: m.specializations,
    socialProfiles: [],
    footprint: 'minimal' as FootprintStrength,
    roomForImprovement:
      'Footprint could not be assessed automatically — review this person’s LinkedIn and other profiles manually.',
    nicheOpportunities: [],
    source: 'onpage' as const,
  }))
}

function buildSummary(members: TeamMemberSocial[], dropped: number): string {
  const withProfiles = members.filter((m) => m.socialProfiles.some((p) => p.status !== 'not_found')).length
  const parts = [`${members.length} team member${members.length === 1 ? '' : 's'} assessed; ${withProfiles} with a findable social footprint.`]
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

  const snippets = await searchMembers(assessed, input)
  const synthesis = await synthesize(assessed, snippets, scraped.siteSocialLinks, input, ctx)

  const members = synthesis?.members?.length ? synthesis.members : baselineMembers(assessed)

  return {
    members,
    teamNicheOpportunities: dedup(synthesis?.teamNicheOpportunities ?? []),
    summary: buildSummary(members, dropped),
    membersAssessed: members.length,
    membersDropped: dropped,
  }
}
