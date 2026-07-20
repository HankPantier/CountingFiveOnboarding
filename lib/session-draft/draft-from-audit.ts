// Drafts an onboarding-session business profile from a completed audit's
// crawled content, using the same LLM-JSON helper the MBP pipeline uses. The
// draft replaces the MBP as the session seed: it fills what the website reveals
// and leaves the rest to Phase-4 gaps (computed with the exact MBP semantics).
// Pure with respect to the DB; the route owns persistence.
import { generateMbpJson } from '@/lib/mbp/generate-json'
import { PUBLISHED_CONTENT_MODEL, GENERATION_PROVIDER_OPTIONS } from '@/lib/content/generation-tuning'
import { buildCorpus, type CorpusPage } from '@/lib/audit/corpus'
import { GBP_URL_RE } from '@/lib/audit/social-hosts'
import { computePhase4Gaps } from '@/lib/mbp-parser'
import { mapAuditToContentPlan, type ContentPlanSummary } from './audit-content-plan'
import { proposeSitemap } from '@/lib/content/sitemap-proposer'
import { enrichSchemaFromIntelligence } from './enrich-from-intelligence'
import type { GapItem } from '@/types/gap-item'
import type { SessionSchema } from '@/types/session-schema'
import type { AuditResult, BusinessSignals } from '@/types/audit-result'

export interface DraftCoverage {
  pagesCrawled: number
  pagesUsed: number
  contentChars: number
  hadBusinessSignals: boolean
  populatedFields: number
  totalDraftableFields: number
  thin: boolean
  reasons: string[]
  /** Summary of the audit-derived content plan (sitemap + redirects). */
  contentPlan: ContentPlanSummary
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
    serviceAreas?: Array<{ city?: string; county?: string; state?: string }>
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

// A Google Business Profile / Maps listing URL, if one is among the site's
// social/outbound links. Feeds the location's schema.org `sameAs` for local pack.
function findGbpUrl(links: string[] = []): string | undefined {
  return links.find((u) => GBP_URL_RE.test(u))
}

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
  "business": { "name": string, "tagline": string, "customerDescription": string, "differentiators": string, "idealClients": string[], "serviceAreas": [ { "city": string, "county": string, "state": string } ] },
  "services": [ { "name": string, "description": string, "offerings": string[] } ],
  "niches": [ { "name": string, "description": string } ],
  "locations": [ { "name": string, "street": string, "city": string, "state": string, "zip": string, "phone": string, "email": string } ],
  "team": [ { "name": string, "title": string, "bio": string } ],
  "culture": { "socialMediaChannels": string[] },
  "brand": { "currentTone": string, "toneAdjectives": string[] }
}
- "niches" = the industries/client types the firm serves.
- "serviceAreas" = specific cities/counties the site says the firm serves (e.g. an "Areas We Serve" section); omit if none stated.
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
      serviceAreas: asObjArr(b.serviceAreas).map((a) => ({ city: asStr(a.city), county: asStr(a.county), state: asStr(a.state) })),
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

  const serviceAreas = (model.business?.serviceAreas ?? [])
    .filter((a) => a.city || a.county)
    .map((a) => {
      const area: { city: string; county?: string; state?: string } = { city: a.city ?? '' }
      if (a.county) area.county = a.county
      if (a.state) area.state = a.state
      return area
    })
  if (serviceAreas.length) b.serviceAreas = serviceAreas

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

  // Attach a detected GBP listing to the primary office so the LocalBusiness
  // schema can express it as `sameAs` (local-pack identity signal).
  const gbpUrl = findGbpUrl(signals?.socialLinks)
  if (gbpUrl && schema.locations.length) schema.locations[0].gbpUrl = gbpUrl

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
): Omit<DraftCoverage, 'contentPlan'> {
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

export async function draftSessionFromAudit(
  result: AuditResult,
  auditId?: string
): Promise<DraftResult> {
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
    // Adaptive thinking spends output tokens on reasoning before the large
    // draft-schema JSON answer; 16000 leaves room so it doesn't truncate under
    // Sonnet 5's effort:'high' thinking + newer (heavier) tokenizer.
    16000,
    { task: 'onboarding', stage: 'mbp', auditId },
    { model: PUBLISHED_CONTENT_MODEL, providerOptions: GENERATION_PROVIDER_OPTIONS },
  )

  const schema = mapToSchema(model ?? {}, signals, result.url)

  // The audit's crawl drives the content plan (deterministic, no AI).
  const plan = mapAuditToContentPlan(result)
  schema.current_sitemap = plan.current_sitemap
  schema.proposed_sitemap = plan.proposed_sitemap
  schema.content_gaps = plan.content_gaps

  // The intelligence layer fills niches, reputation, affiliations, and the
  // reserved content-gap buckets so the chat starts pre-informed.
  if (result.intelligence) enrichSchemaFromIntelligence(schema, result.intelligence)

  // Now that niches/services are populated, propose a differentiated, hierarchical
  // sitemap (new niche/service pages + parent grouping) in place of the flat,
  // update-only deterministic list. Falls back to the deterministic plan internally
  // on AI failure; the try/catch guards the whole draft against a thrown call.
  try {
    schema.proposed_sitemap = await proposeSitemap(schema, result, { auditId })
  } catch (err) {
    console.warn('[draft-from-audit] sitemap proposal failed, keeping deterministic plan:', err)
  }

  const gaps = computePhase4Gaps(schema)
  const coverage: DraftCoverage = {
    ...assessCoverage(schema, result.pages_crawled, pages.length, chars, hadBusinessSignals, model === null),
    contentPlan: plan.summary,
  }

  const contact =
    signals && (signals.phones[0] || signals.emails[0])
      ? { phone: signals.phones[0], email: signals.emails[0] }
      : undefined

  return { schema, gaps, contact, coverage }
}
