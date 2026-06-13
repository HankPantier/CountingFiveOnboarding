// Drafts an onboarding-session business profile from a completed audit's
// crawled content, using the same LLM-JSON helper the MBP pipeline uses. The
// draft replaces the MBP as the session seed: it fills what the website reveals
// and leaves the rest to Phase-4 gaps (computed with the exact MBP semantics).
// Pure with respect to the DB; the route owns persistence.
import { generateMbpJson } from '@/lib/mbp/generate-json'
import { computePhase4Gaps } from '@/lib/mbp-parser'
import type { GapItem } from '@/types/gap-item'
import type { SessionSchema } from '@/types/session-schema'
import type { AuditResult, BusinessSignals } from '@/types/audit-result'

// ~100k tokens of page text (Sonnet has plenty of headroom; leaves room for the
// system prompt + ~6k output). page_text_sample is ≤3000 chars/page.
const CORPUS_CHAR_BUDGET = 400_000

export interface DraftCoverage {
  pagesCrawled: number
  pagesUsed: number
  contentChars: number
  hadBusinessSignals: boolean
  populatedFields: number
  totalDraftableFields: number
  thin: boolean
  reasons: string[]
}

export interface DraftResult {
  schema: SessionSchema
  gaps: GapItem[]
  contact?: { phone?: string; email?: string }
  coverage: DraftCoverage
}

// Loose shape the model returns; everything optional and defensively coerced.
interface DraftModel {
  business?: {
    name?: string
    tagline?: string
    customerDescription?: string
    differentiators?: string
    idealClients?: string[]
  }
  services?: Array<{ name?: string; description?: string; offerings?: string[] }>
  niches?: Array<{ name?: string; description?: string }>
  locations?: Array<{
    name?: string
    street?: string
    city?: string
    state?: string
    zip?: string
    phone?: string
    email?: string
  }>
  team?: Array<{ name?: string; title?: string; bio?: string }>
  culture?: { socialMediaChannels?: string[] }
  brand?: { currentTone?: string; toneAdjectives?: string[] }
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : []
const asObjArr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

function emptySchema(): SessionSchema {
  return {
    business: {
      name: '', tagline: '', positioningOption: '', positioningStatement: '', foundingYear: '',
      firmHistory: '', idealClients: [], geographicScope: '', clientAgeRanges: [], customerNeeds: '',
      customerDescription: '', differentiators: '', affiliations: [], clientSuccessStories: [],
      clientMixBreakdown: '', howClientsFind: '', pricing: '', growthGoals: '',
    },
    locations: [],
    team: [],
    services: [],
    niches: [],
    brand: {
      currentTone: '', aspirationalTone: '', toneAdjectives: [], toneToAvoid: [], voiceExample: '',
      brandPersonality: '', primaryColors: '', typography: '', logoStyle: '', hasBrandGuide: false,
    },
    culture: { missionVisionValues: '', teamDescription: '', socialMediaChannels: [] },
  }
}

interface CorpusPage {
  url: string
  title: string
  text: string
}

const PRIORITY = [
  { re: /\/$|^\/$|home/i, score: 100 },
  { re: /about|who-we-are|our-(firm|story|team)/i, score: 80 },
  { re: /service|what-we-do|solutions|practice/i, score: 70 },
  { re: /team|staff|people|leadership|attorneys|advisors/i, score: 60 },
  { re: /industr|niche|sector|who-we-serve/i, score: 55 },
  { re: /contact|locations?|offices?/i, score: 50 },
  { re: /pricing|fees/i, score: 40 },
]

function pagePriority(url: string, title: string): number {
  const hay = `${url} ${title}`.toLowerCase()
  let best = 10
  for (const p of PRIORITY) if (p.re.test(hay)) best = Math.max(best, p.score)
  return best
}

function buildCorpus(result: AuditResult): { pages: CorpusPage[]; chars: number } {
  const summaries = result.page_analysis_summary ?? []
  const analyzed = result.raw?.analyzed ?? []
  const candidates: CorpusPage[] = summaries.map((s, i) => ({
    url: s.url,
    title: s.title,
    text: (analyzed[i]?.page_text_sample || s.content_snippet || '').trim(),
  }))
  candidates.sort((a, b) => pagePriority(b.url, b.title) - pagePriority(a.url, a.title))

  const pages: CorpusPage[] = []
  let chars = 0
  for (const c of candidates) {
    if (!c.text) continue
    if (chars + c.text.length > CORPUS_CHAR_BUDGET && pages.length > 0) break
    pages.push(c)
    chars += c.text.length
  }
  return { pages, chars }
}

function buildPrompt(corpus: CorpusPage[], signals: BusinessSignals | undefined): string {
  const signalBlock = signals
    ? `Structured data already extracted from the site (trust these where present):
- Organization name: ${signals.organizationName ?? '(none)'}
- Phones: ${signals.phones.join(', ') || '(none)'}
- Emails: ${signals.emails.join(', ') || '(none)'}
- Addresses: ${signals.addresses.join(' | ') || '(none)'}
- Social links: ${signals.socialLinks.join(', ') || '(none)'}
`
    : ''
  const pageBlock = corpus
    .map((p) => `### ${p.title || p.url}\nURL: ${p.url}\n${p.text}`)
    .join('\n\n')

  return `You are building a marketing-onboarding profile for a professional-services firm from its own website content. Extract ONLY facts supported by the content below. Do NOT invent. Omit anything you cannot support.

${signalBlock}
Return a JSON object with this exact shape (omit fields/arrays you can't fill):
{
  "business": { "name": string, "tagline": string, "customerDescription": string, "differentiators": string, "idealClients": string[] },
  "services": [ { "name": string, "description": string, "offerings": string[] } ],
  "niches": [ { "name": string, "description": string } ],
  "locations": [ { "name": string, "street": string, "city": string, "state": string, "zip": string, "phone": string, "email": string } ],
  "team": [ { "name": string, "title": string, "bio": string } ],
  "culture": { "socialMediaChannels": string[] },
  "brand": { "currentTone": string, "toneAdjectives": string[] }
}
- "niches" = the industries/client types the firm serves.
- "brand.currentTone" / "toneAdjectives" = how the site's copy actually reads (e.g. "formal", "approachable").
- Keep descriptions concise (1–2 sentences).

WEBSITE CONTENT:
${pageBlock}`
}

export function validateDraftModel(parsed: unknown): DraftModel | null {
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  const b = (p.business ?? {}) as Record<string, unknown>
  const c = (p.culture ?? {}) as Record<string, unknown>
  const br = (p.brand ?? {}) as Record<string, unknown>
  return {
    business: {
      name: asStr(b.name),
      tagline: asStr(b.tagline),
      customerDescription: asStr(b.customerDescription),
      differentiators: asStr(b.differentiators),
      idealClients: asStrArr(b.idealClients),
    },
    services: asObjArr(p.services).map((s) => ({
      name: asStr(s.name),
      description: asStr(s.description),
      offerings: asStrArr(s.offerings),
    })),
    niches: asObjArr(p.niches).map((n) => ({ name: asStr(n.name), description: asStr(n.description) })),
    locations: asObjArr(p.locations).map((l) => ({
      name: asStr(l.name), street: asStr(l.street), city: asStr(l.city), state: asStr(l.state),
      zip: asStr(l.zip), phone: asStr(l.phone), email: asStr(l.email),
    })),
    team: asObjArr(p.team).map((t) => ({ name: asStr(t.name), title: asStr(t.title), bio: asStr(t.bio) })),
    culture: { socialMediaChannels: asStrArr(c.socialMediaChannels) },
    brand: { currentTone: asStr(br.currentTone), toneAdjectives: asStrArr(br.toneAdjectives) },
  }
}

function mapToSchema(
  model: DraftModel,
  signals: BusinessSignals | undefined,
  websiteUrl: string,
): SessionSchema {
  const schema = emptySchema()
  schema.websiteUrl = websiteUrl

  const b = schema.business!
  b.name = model.business?.name || signals?.organizationName || ''
  b.tagline = model.business?.tagline ?? ''
  b.customerDescription = model.business?.customerDescription ?? ''
  b.differentiators = model.business?.differentiators ?? ''
  b.idealClients = model.business?.idealClients ?? []

  schema.services = (model.services ?? [])
    .filter((s) => s.name)
    .map((s) => ({ name: s.name!, description: s.description ?? '', offerings: s.offerings ?? [] }))

  schema.niches = (model.niches ?? [])
    .filter((n) => n.name)
    .map((n) => ({ name: n.name!, description: n.description ?? '', icp: '', painPoints: '', valueProp: '' }))

  schema.locations = (model.locations ?? [])
    .filter((l) => l.name || l.street || l.city)
    .map((l) => ({
      name: l.name ?? '', street: l.street ?? '', line2: '', city: l.city ?? '', state: l.state ?? '',
      zip: l.zip ?? '', phone: l.phone ?? '', fax: '', email: l.email ?? '', hours: {},
    }))

  schema.team = (model.team ?? [])
    .filter((t) => t.name)
    .map((t) => ({ name: t.name!, title: t.title ?? '', certifications: [], bio: t.bio ?? '', specializations: [] }))

  // Merge AI-named channels with the structured social links found in signals.
  const channels = new Set<string>([
    ...(model.culture?.socialMediaChannels ?? []),
    ...(signals?.socialLinks ?? []),
  ])
  schema.culture!.socialMediaChannels = [...channels]

  schema.brand!.currentTone = model.brand?.currentTone ?? ''
  schema.brand!.toneAdjectives = model.brand?.toneAdjectives ?? []

  return schema
}

function assessCoverage(
  schema: SessionSchema,
  pagesCrawled: number,
  pagesUsed: number,
  contentChars: number,
  hadBusinessSignals: boolean,
  aiFailed: boolean,
): DraftCoverage {
  const checks = [
    !!schema.business?.name,
    !!(schema.business?.tagline || schema.business?.customerDescription),
    (schema.services?.length ?? 0) > 0,
    (schema.niches?.length ?? 0) > 0,
    (schema.locations?.length ?? 0) > 0,
    (schema.team?.length ?? 0) > 0,
    (schema.culture?.socialMediaChannels?.length ?? 0) > 0,
    !!schema.brand?.currentTone,
  ]
  const populatedFields = checks.filter(Boolean).length
  const totalDraftableFields = checks.length

  const reasons: string[] = []
  if (aiFailed) reasons.push('the AI draft could not be generated')
  if (pagesCrawled <= 3) reasons.push('only a few pages were crawled')
  if (contentChars < 2000) reasons.push('very little page text was available')
  if (!hadBusinessSignals) reasons.push('no structured business data (schema.org/contact) was found')
  if (populatedFields / totalDraftableFields < 0.3) reasons.push('few profile fields could be filled')

  return {
    pagesCrawled,
    pagesUsed,
    contentChars,
    hadBusinessSignals,
    populatedFields,
    totalDraftableFields,
    thin: reasons.length > 0,
    reasons,
  }
}

export async function draftSessionFromAudit(result: AuditResult): Promise<DraftResult> {
  const signals = result.business_signals
  const hadBusinessSignals = !!(
    signals &&
    (signals.organizationName ||
      signals.phones.length ||
      signals.emails.length ||
      signals.socialLinks.length ||
      signals.addresses.length)
  )

  const { pages, chars } = buildCorpus(result)
  const model = await generateMbpJson<DraftModel>(
    buildPrompt(pages, signals),
    validateDraftModel,
    6000,
  )

  const schema = mapToSchema(model ?? {}, signals, result.url)
  const gaps = computePhase4Gaps(schema)
  const coverage = assessCoverage(
    schema,
    result.pages_crawled,
    pages.length,
    chars,
    hadBusinessSignals,
    model === null,
  )

  const contact =
    signals && (signals.phones[0] || signals.emails[0])
      ? { phone: signals.phones[0], email: signals.emails[0] }
      : undefined

  return { schema, gaps, contact, coverage }
}
