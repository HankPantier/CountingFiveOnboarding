// Extracts a structured onboarding profile from the rep's freeform call notes
// and merges it NON-DESTRUCTIVELY into the existing schema: only blank fields
// are filled, so audit-derived and human-edited values are never overwritten.
// Pure with respect to the DB; the route owns persistence and token recording.
import { generateMbpJson } from '@/lib/mbp/generate-json'
import { PUBLISHED_CONTENT_MODEL, OUTLINE_PROVIDER_OPTIONS } from '@/lib/content/generation-tuning'
import { deepSetPath, getByPath, isPathFilled } from '@/lib/mbp/schema-write'
import type { GapItem } from '@/types/gap-item'
import type { SessionSchema } from '@/types/session-schema'
import type { TokenContext } from '@/lib/content/token-usage'

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : []
const asObjArr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

// The shape the model returns — every field optional, defensively coerced.
export interface NotesModel {
  contact?: { firstName?: string; lastName?: string; email?: string; phone?: string }
  business?: {
    name?: string; tagline?: string; customerDescription?: string; differentiators?: string
    foundingYear?: string; firmHistory?: string; idealClients?: string[]; geographicScope?: string
    customerNeeds?: string; howClientsFind?: string; pricing?: string; growthGoals?: string
    serviceAreas?: Array<{ city?: string; county?: string; state?: string }>; targetKeywords?: string[]
    contentEmphasis?: string[]; contentExclusions?: string[]
  }
  services?: Array<{ name?: string; description?: string; offerings?: string[] }>
  niches?: Array<{ name?: string; description?: string; revenueBand?: string; businessStage?: string; decisionMaker?: string }>
  locations?: Array<{ name?: string; street?: string; city?: string; state?: string; zip?: string; phone?: string; email?: string }>
  team?: Array<{ name?: string; title?: string; bio?: string }>
  clientPortals?: Array<{ label?: string; url?: string; description?: string; category?: string }>
  culture?: { missionVisionValues?: string; teamDescription?: string; socialMediaChannels?: string[] }
  brand?: {
    currentTone?: string; aspirationalTone?: string; toneAdjectives?: string[]; toneToAvoid?: string[]
    primaryColors?: string; voiceExample?: string; brandPersonality?: string
  }
  // Any material fact the rep noted that maps to no structured field above.
  // Appended (never blank-only) to additional.otherDetails so it's never lost.
  additionalNotes?: string
}

export function validateNotesModel(parsed: unknown): NotesModel | null {
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  const c = (p.contact ?? {}) as Record<string, unknown>
  const b = (p.business ?? {}) as Record<string, unknown>
  const cu = (p.culture ?? {}) as Record<string, unknown>
  const br = (p.brand ?? {}) as Record<string, unknown>
  return {
    contact: { firstName: asStr(c.firstName), lastName: asStr(c.lastName), email: asStr(c.email), phone: asStr(c.phone) },
    business: {
      name: asStr(b.name), tagline: asStr(b.tagline), customerDescription: asStr(b.customerDescription),
      differentiators: asStr(b.differentiators), foundingYear: asStr(b.foundingYear), firmHistory: asStr(b.firmHistory),
      idealClients: asStrArr(b.idealClients), geographicScope: asStr(b.geographicScope), customerNeeds: asStr(b.customerNeeds),
      howClientsFind: asStr(b.howClientsFind), pricing: asStr(b.pricing), growthGoals: asStr(b.growthGoals),
      serviceAreas: asObjArr(b.serviceAreas).map((a) => ({ city: asStr(a.city), county: asStr(a.county), state: asStr(a.state) })),
      targetKeywords: asStrArr(b.targetKeywords),
      contentEmphasis: asStrArr(b.contentEmphasis),
      contentExclusions: asStrArr(b.contentExclusions),
    },
    services: asObjArr(p.services).map((s) => ({ name: asStr(s.name), description: asStr(s.description), offerings: asStrArr(s.offerings) })),
    niches: asObjArr(p.niches).map((n) => ({ name: asStr(n.name), description: asStr(n.description), revenueBand: asStr(n.revenueBand), businessStage: asStr(n.businessStage), decisionMaker: asStr(n.decisionMaker) })),
    locations: asObjArr(p.locations).map((l) => ({
      name: asStr(l.name), street: asStr(l.street), city: asStr(l.city), state: asStr(l.state),
      zip: asStr(l.zip), phone: asStr(l.phone), email: asStr(l.email),
    })),
    team: asObjArr(p.team).map((t) => ({ name: asStr(t.name), title: asStr(t.title), bio: asStr(t.bio) })),
    clientPortals: asObjArr(p.clientPortals).map((cp) => ({ label: asStr(cp.label), url: asStr(cp.url), description: asStr(cp.description), category: asStr(cp.category) })),
    culture: {
      missionVisionValues: asStr(cu.missionVisionValues), teamDescription: asStr(cu.teamDescription),
      socialMediaChannels: asStrArr(cu.socialMediaChannels),
    },
    brand: {
      currentTone: asStr(br.currentTone), aspirationalTone: asStr(br.aspirationalTone), toneAdjectives: asStrArr(br.toneAdjectives),
      toneToAvoid: asStrArr(br.toneToAvoid), primaryColors: asStr(br.primaryColors), voiceExample: asStr(br.voiceExample),
      brandPersonality: asStr(br.brandPersonality),
    },
    additionalNotes: asStr(p.additionalNotes),
  }
}

// A single field the extraction wants to write, with a human label for the diff.
interface Candidate { path: string; label: string; value: unknown }

// Flattens the model into scalar/array write candidates. Arrays of objects
// (services/niches/team/locations) are all-or-nothing: only offered when the
// current array is empty (merging object arrays element-wise is ambiguous and
// risks clobbering audit-derived entries).
function candidates(model: NotesModel): Candidate[] {
  const out: Candidate[] = []
  const scalar = (path: string, label: string, value: string | undefined) => {
    if (value && value.trim()) out.push({ path, label, value: value.trim() })
  }
  const arr = (path: string, label: string, value: string[] | undefined) => {
    if (value && value.length) out.push({ path, label, value })
  }

  const c = model.contact ?? {}
  scalar('contact.firstName', 'First name', c.firstName)
  scalar('contact.lastName', 'Last name', c.lastName)
  scalar('contact.email', 'Email', c.email)
  scalar('contact.phone', 'Phone', c.phone)

  const b = model.business ?? {}
  scalar('business.name', 'Business name', b.name)
  scalar('business.tagline', 'Tagline', b.tagline)
  scalar('business.customerDescription', 'Customer description', b.customerDescription)
  scalar('business.differentiators', 'Differentiators', b.differentiators)
  scalar('business.foundingYear', 'Founding year', b.foundingYear)
  scalar('business.firmHistory', 'Firm history', b.firmHistory)
  scalar('business.geographicScope', 'Geographic scope', b.geographicScope)
  scalar('business.customerNeeds', 'Customer needs', b.customerNeeds)
  scalar('business.howClientsFind', 'How clients find the firm', b.howClientsFind)
  scalar('business.pricing', 'Pricing', b.pricing)
  scalar('business.growthGoals', 'Growth goals', b.growthGoals)
  arr('business.idealClients', 'Ideal clients', b.idealClients)
  arr('business.targetKeywords', 'Target keywords', b.targetKeywords)
  arr('business.contentEmphasis', 'Content to emphasize', b.contentEmphasis)
  arr('business.contentExclusions', 'Content to exclude', b.contentExclusions)

  const serviceAreas = (b.serviceAreas ?? []).filter((a) => a.city || a.county)
  if (serviceAreas.length) {
    out.push({
      path: 'business.serviceAreas',
      label: `Service areas (${serviceAreas.length})`,
      value: serviceAreas.map((a) => {
        const o: { city: string; county?: string; state?: string } = { city: a.city ?? '' }
        if (a.county) o.county = a.county
        if (a.state) o.state = a.state
        return o
      }),
    })
  }

  const cu = model.culture ?? {}
  scalar('culture.missionVisionValues', 'Mission / vision / values', cu.missionVisionValues)
  scalar('culture.teamDescription', 'Team description', cu.teamDescription)
  arr('culture.socialMediaChannels', 'Social media channels', cu.socialMediaChannels)

  const br = model.brand ?? {}
  scalar('brand.currentTone', 'Current tone', br.currentTone)
  scalar('brand.aspirationalTone', 'Aspirational tone', br.aspirationalTone)
  scalar('brand.primaryColors', 'Brand colors', br.primaryColors)
  scalar('brand.voiceExample', 'Voice example', br.voiceExample)
  scalar('brand.brandPersonality', 'Brand personality', br.brandPersonality)
  arr('brand.toneAdjectives', 'Tone adjectives', br.toneAdjectives)
  arr('brand.toneToAvoid', 'Tone to avoid', br.toneToAvoid)

  const services = (model.services ?? []).filter((s) => s.name)
  if (services.length) out.push({ path: 'services', label: `Services (${services.length})`, value: services.map((s) => ({ name: s.name!, description: s.description ?? '', offerings: s.offerings ?? [] })) })
  const niches = (model.niches ?? []).filter((n) => n.name)
  if (niches.length) out.push({ path: 'niches', label: `Niches (${niches.length})`, value: niches.map((n) => {
    const base: Record<string, unknown> = { name: n.name!, description: n.description ?? '', icp: '', painPoints: '', valueProp: '' }
    if (n.revenueBand) base.revenueBand = n.revenueBand
    if (n.businessStage) base.businessStage = n.businessStage
    if (n.decisionMaker) base.decisionMaker = n.decisionMaker
    return base
  }) })
  const team = (model.team ?? []).filter((t) => t.name)
  if (team.length) out.push({ path: 'team', label: `Team (${team.length})`, value: team.map((t) => ({ name: t.name!, title: t.title ?? '', certifications: [], bio: t.bio ?? '', specializations: [] })) })
  const locations = (model.locations ?? []).filter((l) => l.name || l.street || l.city)
  if (locations.length) out.push({ path: 'locations', label: `Locations (${locations.length})`, value: locations.map((l) => ({ name: l.name ?? '', street: l.street ?? '', line2: '', city: l.city ?? '', state: l.state ?? '', zip: l.zip ?? '', phone: l.phone ?? '', fax: '', email: l.email ?? '', hours: {} })) })
  const clientPortals = (model.clientPortals ?? []).filter((p) => p.label && p.url)
  if (clientPortals.length) out.push({ path: 'clientPortals', label: `Client portals (${clientPortals.length})`, value: clientPortals.map((p) => {
    const base: Record<string, unknown> = { label: p.label!, url: p.url! }
    if (p.description) base.description = p.description
    if (p.category) base.category = p.category
    return base
  }) })

  return out
}

export interface AppliedField { path: string; label: string }

export interface ExtractionResult {
  schema: SessionSchema
  gaps: GapItem[]
  applied: AppliedField[]
}

// Merge the model into the schema, writing only where the current value is
// blank, then resolve any gap whose field is now filled.
export function mergeNotesExtraction(
  currentSchema: SessionSchema,
  currentGaps: GapItem[],
  model: NotesModel,
): ExtractionResult {
  let schema = currentSchema as Record<string, unknown>
  const applied: AppliedField[] = []

  for (const cand of candidates(model)) {
    if (isPathFilled(schema, cand.path)) continue
    schema = deepSetPath(schema, cand.path, cand.value)
    applied.push({ path: cand.path, label: cand.label })
  }

  // additional.otherDetails is the freeform sink for facts that fit no
  // structured field. Unlike every other candidate it is APPENDED, not
  // blank-only-filled, so repeated extractions accumulate rather than clobber.
  // The dedup guard skips text already present verbatim (re-running extraction
  // on unchanged notes must not duplicate the paragraph).
  const extra = asStr(model.additionalNotes)
  if (extra) {
    const existing = asStr(getByPath(schema, 'additional.otherDetails'))
    if (!existing.includes(extra)) {
      schema = deepSetPath(schema, 'additional.otherDetails', existing ? `${existing}\n\n${extra}` : extra)
      applied.push({ path: 'additional.otherDetails', label: 'Additional details' })
    }
  }

  const merged = schema as SessionSchema
  const gaps = currentGaps.map((g) =>
    g.resolved || isPathFilled(merged, g.field) ? { ...g, resolved: true } : g,
  )

  return { schema: merged, gaps, applied }
}

function knownSummary(schema: SessionSchema): string {
  const filled: string[] = []
  const check = (path: string, label: string) => { if (isPathFilled(schema as Record<string, unknown>, path)) filled.push(label) }
  check('business.name', 'business name'); check('business.tagline', 'tagline')
  check('business.differentiators', 'differentiators'); check('business.foundingYear', 'founding year')
  check('services', 'services'); check('niches', 'niches'); check('team', 'team'); check('locations', 'locations')
  check('clientPortals', 'client portals')
  check('brand.currentTone', 'brand tone'); check('culture.missionVisionValues', 'mission/values')
  check('contact.email', 'contact email')
  return filled.length ? filled.join(', ') : '(nothing yet)'
}

function buildPrompt(notes: string, schema: SessionSchema, gaps: GapItem[]): string {
  const openGaps = gaps.filter((g) => !g.resolved).map((g) => g.label).slice(0, 40)
  return `You are extracting a CPA-firm onboarding profile from a Revaltus rep's notes taken during a live client call. Extract ONLY facts stated or clearly implied in the notes. Do NOT invent. Omit anything the notes don't support.

ALREADY ON FILE (from an earlier audit — do not restate; focus on what the notes add): ${knownSummary(schema)}

QUESTIONS THIS CALL WAS MEANT TO ANSWER (fill these where the notes cover them): ${openGaps.length ? openGaps.join('; ') : '(none flagged)'}

Return a JSON object with this exact shape (omit any field/array you can't fill from the notes):
{
  "contact": { "firstName": string, "lastName": string, "email": string, "phone": string },
  "business": { "name": string, "tagline": string, "customerDescription": string, "differentiators": string, "foundingYear": string, "firmHistory": string, "idealClients": string[], "geographicScope": string, "customerNeeds": string, "howClientsFind": string, "pricing": string, "growthGoals": string, "serviceAreas": [ { "city": string, "county": string, "state": string } ], "targetKeywords": string[], "contentEmphasis": string[], "contentExclusions": string[] },
  "services": [ { "name": string, "description": string, "offerings": string[] } ],
  "niches": [ { "name": string, "description": string, "revenueBand": string, "businessStage": string, "decisionMaker": string } ],
  "locations": [ { "name": string, "street": string, "city": string, "state": string, "zip": string, "phone": string, "email": string } ],
  "team": [ { "name": string, "title": string, "bio": string } ],
  "clientPortals": [ { "label": string, "url": string, "description": string, "category": string } ],
  "culture": { "missionVisionValues": string, "teamDescription": string, "socialMediaChannels": string[] },
  "brand": { "currentTone": string, "aspirationalTone": string, "toneAdjectives": string[], "toneToAvoid": string[], "primaryColors": string, "voiceExample": string, "brandPersonality": string },
  "additionalNotes": string
}
- "niches" = the industries / client types the firm serves. Per niche, "revenueBand"/"businessStage"/"decisionMaker" describe the typical client (e.g. "$1–5M revenue", "growth-stage", "owner/founder") — only when the notes state it.
- "serviceAreas" = the specific cities/counties the firm serves or targets (local-SEO geography); "targetKeywords" = search terms the firm wants to rank for, if mentioned.
- "contentEmphasis" = industries, services, or topics the notes say to FEATURE, prioritize, or lean into on the new site. "contentExclusions" = anything the notes say to AVOID, NOT include, drop, de-emphasize, or "don't cover" (industries, services, or topics). Capture each as a short phrase (e.g. "real estate", "cryptocurrency", "audit services"). Only include what the notes explicitly direct — do not infer exclusions from mere absence.
- "clientPortals" = external tools/portals the firm's CLIENTS log into (e.g. QuickBooks Online, ShareFile/secure file upload, payroll, online bill-pay, remote support). Give each a short "category" (e.g. Documents, Payments, Support) when clear. NEVER capture passwords or credentials — links only.
- "additionalNotes" = any material fact about the firm the notes state that does NOT fit a field above — history quirks, notable relationships, personal/operational context, stated preferences, anything useful for writing the site later. Capture it as concise prose. Omit entirely if the notes hold nothing beyond the structured fields. Never invent.
- Keep descriptions concise (1–2 sentences).

CALL NOTES:
${notes}`
}

// Generates the extraction model from notes. Sonnet 5 (structured generation
// tier) at LOW effort — this is mapping, not creative writing, so it doesn't
// need the high-effort thinking budget the page-body/draft generators use.
export async function extractNotesModel(
  notes: string,
  schema: SessionSchema,
  gaps: GapItem[],
  ctx: TokenContext,
): Promise<NotesModel | null> {
  return generateMbpJson<NotesModel>(
    buildPrompt(notes, schema, gaps),
    validateNotesModel,
    4000,
    ctx,
    { model: PUBLISHED_CONTENT_MODEL, providerOptions: OUTLINE_PROVIDER_OPTIONS },
  )
}
