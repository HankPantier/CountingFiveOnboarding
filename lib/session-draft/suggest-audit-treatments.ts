// Second AI pass in the audit→seed flow: for every detected/recommended service,
// industry, and sub-service it suggests a treatment (Own page / Content block /
// Exclude) with a one-line rationale, plus a keep/remove call per team member and
// a geographic-scope call. The Audit Review step opens pre-selected to these so
// the operator CONFIRMS instead of deciding blind. Runs once at seed time (after
// enrichment), persisted to _meta.audit_suggestions, non-fatal on failure. Pure
// with respect to the DB; draftSessionFromAudit owns persistence.
import { generateMbpJson } from '@/lib/mbp/generate-json'
import { PUBLISHED_CONTENT_MODEL, GENERATION_PROVIDER_OPTIONS } from '@/lib/content/generation-tuning'
import { slugify } from '@/lib/content/sitemap-utils'
import { activeNiches } from '@/lib/content/active-niches'
import { activeServices } from '@/lib/content/active-services'
import type { SessionSchema } from '@/types/session-schema'
import type { AuditIntelligence } from '@/types/audit-result'

export type AuditSuggestions = NonNullable<NonNullable<SessionSchema['_meta']>['audit_suggestions']>

const norm = (s: string): string => s.trim().toLowerCase()
const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const asObjArr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

const TREATMENTS = ['page', 'block', 'exclude'] as const
const CONFIDENCES = ['high', 'medium', 'low'] as const
const SCOPES = ['local', 'regional', 'national'] as const
type Treatment = (typeof TREATMENTS)[number]
type Confidence = (typeof CONFIDENCES)[number]
type Scope = (typeof SCOPES)[number]

const asTreatment = (v: unknown): Treatment | null => (TREATMENTS as readonly string[]).includes(asStr(v)) ? (asStr(v) as Treatment) : null
const asConfidence = (v: unknown): Confidence | undefined => (CONFIDENCES as readonly string[]).includes(asStr(v)) ? (asStr(v) as Confidence) : undefined
const asScope = (v: unknown): Scope | null => (SCOPES as readonly string[]).includes(asStr(v)) ? (asStr(v) as Scope) : null

// URL resolution context: the known page-level service/niche names so a block's
// suggested parent (a sibling NAME from the model) becomes a real sitemap URL that
// matches the review's parent dropdown. Unknown/blank parent → the category hub.
export interface SuggestCtx {
  serviceNames: string[]
  nicheNames: string[]
}

function resolveParent(raw: string, kind: 'service' | 'niche', ctx: SuggestCtx): string {
  const hub = kind === 'service' ? '/services' : '/industries'
  const name = asStr(raw)
  if (!name) return hub
  const names = kind === 'service' ? ctx.serviceNames : ctx.nicheNames
  const match = names.find((n) => norm(n) === norm(name))
  return match ? `${hub}/${slugify(match)}` : hub
}

// Pure coercion of the model's JSON into AuditSuggestions. Drops entries missing a
// name (or `niche` for subs), an invalid enum, or an empty rationale. Resolves
// block parents to URLs. Returns null when nothing usable survives (→ the review
// falls back to today's origin defaults). Exported for testing.
export function coerceSuggestions(parsed: unknown, ctx: SuggestCtx, generatedAt: string): AuditSuggestions | null {
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>

  const item = (raw: Record<string, unknown>, kind: 'service' | 'niche') => {
    const name = asStr(raw.name)
    const treatment = asTreatment(raw.treatment)
    const rationale = asStr(raw.rationale)
    if (!name || !treatment || !rationale) return null
    const confidence = asConfidence(raw.confidence)
    return {
      name,
      treatment,
      ...(treatment === 'block' ? { parent: resolveParent(asStr(raw.parent), kind, ctx) } : {}),
      rationale,
      ...(confidence ? { confidence } : {}),
    }
  }

  const services = asObjArr(p.services).map((r) => item(r, 'service')).filter((x): x is NonNullable<typeof x> => !!x)
  const niches = asObjArr(p.niches).map((r) => item(r, 'niche')).filter((x): x is NonNullable<typeof x> => !!x)
  const subCategories = asObjArr(p.subCategories).flatMap((r) => {
    const niche = asStr(r.niche)
    const name = asStr(r.name)
    const treatment = asTreatment(r.treatment)
    const rationale = asStr(r.rationale)
    if (!niche || !name || !treatment || !rationale) return []
    const confidence = asConfidence(r.confidence)
    // Sub-services default to their niche page; only carry a parent when promoted
    // to a block on some other page (rare) — otherwise resolveBlockParent handles it.
    return [{ niche, name, treatment, rationale, ...(confidence ? { confidence } : {}) }]
  })
  const team = asObjArr(p.team).flatMap((r) => {
    const name = asStr(r.name)
    const decision: 'keep' | 'remove' | null = r.decision === 'keep' ? 'keep' : r.decision === 'remove' ? 'remove' : null
    const rationale = asStr(r.rationale)
    if (!name || !decision || !rationale) return []
    const confidence = asConfidence(r.confidence)
    return [{ name, decision, rationale, ...(confidence ? { confidence } : {}) }]
  })

  let geoScope: AuditSuggestions['geoScope']
  if (p.geoScope && typeof p.geoScope === 'object') {
    const g = p.geoScope as Record<string, unknown>
    const scope = asScope(g.scope)
    const rationale = asStr(g.rationale)
    if (scope && rationale) {
      const confidence = asConfidence(g.confidence)
      geoScope = {
        scope,
        ...(asStr(g.primaryArea) ? { primaryArea: asStr(g.primaryArea) } : {}),
        rationale,
        ...(confidence ? { confidence } : {}),
      }
    }
  }

  if (!services.length && !niches.length && !subCategories.length && !team.length && !geoScope) return null
  return {
    ...(services.length ? { services } : {}),
    ...(niches.length ? { niches } : {}),
    ...(subCategories.length ? { subCategories } : {}),
    ...(team.length ? { team } : {}),
    ...(geoScope ? { geoScope } : {}),
    generatedAt,
  }
}

function buildPrompt(schema: SessionSchema, intel: AuditIntelligence | undefined): string {
  const niches = activeNiches(schema).filter((n) => n.name?.trim())
  const services = activeServices(schema).filter((s) => s.name?.trim())

  const nicheBlock = niches
    .map((n) => {
      const subs = (n.subCategories ?? []).filter((s) => s?.name?.trim() && s.status !== 'dropped').map((s) => s.name)
      const sig = n.signal ? ` [signal: ${n.signal}]` : ''
      const subLine = subs.length ? `\n    sub-services: ${subs.join(', ')}` : ''
      return `- ${n.name}${sig}: ${n.description || n.valueProp || ''}${subLine}`
    })
    .join('\n')
  const serviceBlock = services.map((s) => `- ${s.name}: ${s.description || ''}`).join('\n')
  const teamBlock = (schema.team ?? [])
    .filter((t) => t?.name?.trim())
    .map((t) => `- ${t.name}${t.title ? ` (${t.title})` : ''}${(t.externalFootprint ? ` [footprint: ${t.externalFootprint}]` : '')}`)
    .join('\n')
  const areaBlock = (schema.business?.serviceAreas ?? [])
    .filter((a) => a.city?.trim())
    .map((a) => `- ${[a.city, a.state].filter(Boolean).join(', ')}${a.primary ? ' (primary)' : ''}`)
    .join('\n')

  const recommendedNiches = (schema._meta?.opportunities?.highOpportunityNiches ?? []).filter((n) => n?.trim())
  const nicheGaps = (schema.content_gaps?.nicheGaps ?? []).slice(0, 10)
  const comp = intel?.competitive
  const compBlock = comp
    ? [
        comp.keyword_rankings?.length ? `Keyword rankings: ${comp.keyword_rankings.slice(0, 8).map((k) => `${k.keyword}${k.rank != null ? ` (#${k.rank})` : ''}`).join('; ')}` : '',
        comp.ai_search_presence ? `AI search presence: ${comp.ai_search_presence}` : '',
        comp.local_seo ? `Local SEO: ${comp.local_seo}` : '',
      ].filter(Boolean).join('\n')
    : ''
  const recs = intel?.narrative?.recommendations?.map((r) => r.title).filter(Boolean).slice(0, 8) ?? []

  return `You are a website information architect for a professional-services (CPA) firm. For each item below, recommend how it should appear on the firm's NEW website and WHY, so a reviewer can confirm your call in one click.

TREATMENTS:
- "page" = its own dedicated page. Use when there is distinct standalone search demand / audience / enough substance to fill a page.
- "block" = a section on a PARENT page, not its own URL. Use when the topic is real but thin, overlaps a parent, or has little standalone demand. You MUST name the parent (an existing service or industry NAME from the lists below, or leave blank for the section hub).
- "exclude" = leave it off the new site entirely. Only use this with EVIDENCE stated in the rationale (e.g. no real content on the current site, off-strategy for this firm, superseded by another offering). When in doubt, prefer "block" over "exclude".

SERVICES (currently on the site):
${serviceBlock || '(none)'}

INDUSTRIES / NICHES (currently on the site; signal = audit confidence the firm truly serves it; sub-services listed under each):
${nicheBlock || '(none)'}

INDUSTRIES RECOMMENDED BY THE AUDIT (not yet on the site — suggest page/block if worth adding, else omit):
${recommendedNiches.length ? recommendedNiches.map((n) => `- ${n}`).join('\n') : '(none)'}
${nicheGaps.length ? `\nUNTAPPED NICHE GAPS: ${nicheGaps.join('; ')}` : ''}

ALSO PROPOSE NET-NEW additions this firm should add that are NOT already listed above — new SERVICES and new SUB-SERVICES (under an existing industry) with clear demand for this kind of firm. Include them in the "services" / "subCategories" arrays with treatment "page" or "block" (never "exclude" for a net-new proposal) and a rationale naming the opportunity. Only genuinely valuable additions — do not pad.

TEAM (recommend keep or remove — remove only with evidence, e.g. no presence anywhere):
${teamBlock || '(none)'}

SERVICE AREAS:
${areaBlock || '(none)'}

${compBlock ? `COMPETITIVE / SEARCH SIGNALS:\n${compBlock}\n` : ''}${recs.length ? `AUDIT RECOMMENDATIONS: ${recs.join('; ')}\n` : ''}
Return ONLY a JSON object with this exact shape (omit an array if empty):
{
  "services": [ { "name": string, "treatment": "page"|"block"|"exclude", "parent": string (a service/industry name, only for block), "rationale": string (ONE sentence), "confidence": "high"|"medium"|"low" } ],
  "niches": [ { "name": string, "treatment": ..., "parent": string (only for block), "rationale": string, "confidence": ... } ],
  "subCategories": [ { "niche": string, "name": string, "treatment": ..., "rationale": string, "confidence": ... } ],
  "team": [ { "name": string, "decision": "keep"|"remove", "rationale": string, "confidence": ... } ],
  "geoScope": { "scope": "local"|"regional"|"national", "primaryArea": string, "rationale": string, "confidence": ... }
}
Rules: cover EVERY service, niche, sub-service, and team member listed, plus each recommended industry worth adding. Rationale is ONE concise sentence a firm owner would understand. Sub-services usually stay "block" on their industry page — only "page" when a sub-service has strong standalone demand. Return ONLY the JSON.`
}

export async function suggestAuditTreatments(
  schema: SessionSchema,
  intel: AuditIntelligence | undefined,
  ctx?: { auditId?: string },
): Promise<AuditSuggestions | null> {
  const hasItems =
    activeServices(schema).some((s) => s.name?.trim()) ||
    activeNiches(schema).some((n) => n.name?.trim()) ||
    (schema.team ?? []).some((t) => t?.name?.trim())
  if (!hasItems) return null

  const suggestCtx: SuggestCtx = {
    serviceNames: activeServices(schema).map((s) => s.name).filter(Boolean),
    nicheNames: activeNiches(schema).map((n) => n.name).filter(Boolean),
  }
  const generatedAt = new Date().toISOString()

  return generateMbpJson<AuditSuggestions>(
    buildPrompt(schema, intel),
    (parsed) => coerceSuggestions(parsed, suggestCtx, generatedAt),
    8000,
    { task: 'onboarding', stage: 'mbp', auditId: ctx?.auditId },
    { model: PUBLISHED_CONTENT_MODEL, providerOptions: GENERATION_PROVIDER_OPTIONS },
  )
}
