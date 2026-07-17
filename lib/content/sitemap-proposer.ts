// Proposes the rebuild sitemap an admin reviews at the content Sitemap phase.
// Two layers: a deterministic skeleton (existing pages as updates + templated
// niche/service pages with a parent hierarchy) and an AI enrichment pass that
// reconciles them into a differentiated, hierarchical sitemap. The skeleton is
// also the fallback when the AI call fails, so the proposal never regresses to
// the old update-only flat list.
import { buildFirmContext } from './brand-voice'
import { generateMbpJson } from '@/lib/mbp/generate-json'
import { OUTLINE_PROVIDER_OPTIONS } from './generation-tuning'
import { slugify } from './sitemap-utils'
import type { SessionSchema } from '@/types/session-schema'
import type { AuditResult } from '@/types/audit-result'
import type { TokenContext } from './token-pricing'

type ProposedSitemap = NonNullable<SessionSchema['proposed_sitemap']>
type ProposedPage = ProposedSitemap[number]

const MAX_PAGES = 60
const normUrl = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase()

// Local-SEO caps. Geo landing pages help local intent but thin/duplicate geo
// pages are penalized as doorway pages, so we cap deterministically: at most
// LOCAL_HUB_CAP per-city location hubs, and (top LOCAL_SERVICE_CAP services) ×
// (up to LOCAL_AREA_CAP primary areas) service×geo pages. When serviceAreas
// carry `primary` flags those areas are preferred before the cap is applied.
const LOCAL_HUB_CAP = 6
const LOCAL_SERVICE_CAP = 3
const LOCAL_AREA_CAP = 4

type ServiceArea = NonNullable<
  NonNullable<SessionSchema['business']>['serviceAreas']
>[number]

// City label like "Nashua, NH" (or just the city when no state is set).
const areaLabel = (a: ServiceArea): string =>
  a.state?.trim() ? `${a.city.trim()}, ${a.state.trim()}` : a.city.trim()

// Order areas so `primary: true` ones come first, preserving input order within
// each group (stable), then truncate to `cap`.
function rankAreas(areas: ServiceArea[], cap: number): ServiceArea[] {
  const primary = areas.filter(a => a.primary)
  const rest = areas.filter(a => !a.primary)
  return [...primary, ...rest].slice(0, cap)
}

// ── Deterministic skeleton ───────────────────────────────────────────────────
export function buildSkeletonProposal(
  schema: SessionSchema,
  auditResult: AuditResult | null = null
): ProposedSitemap {
  const out: ProposedSitemap = []
  const seen = new Set<string>()
  const push = (p: ProposedPage) => {
    const key = normUrl(p.url)
    if (!p.url?.trim() || seen.has(key)) return
    seen.add(key)
    out.push(p)
  }

  // Existing live pages → updates. Prefer the planned current_sitemap; fall back
  // to the raw audit crawl when a session wasn't seeded from current_sitemap.
  const kept = (schema.current_sitemap ?? []).filter(c => c.action === 'keep' && c.live)
  for (const c of kept) push({ url: c.url, title: c.title || c.url, status: 'update' })
  if (!kept.length && auditResult?.page_analysis_summary) {
    for (const p of auditResult.page_analysis_summary) {
      if (p.status_code === 200) push({ url: p.url, title: p.title || p.url, status: 'update' })
    }
  }

  // Templated differentiating pages from the firm's niches + services.
  const niches = (schema.niches ?? []).filter(n => n.name?.trim())
  if (niches.length) {
    push({ url: '/industries', title: 'Industries we serve', status: 'new', parent: '/' })
    for (const n of niches) {
      push({
        url: `/industries/${slugify(n.name)}`,
        title: n.name,
        status: 'new',
        parent: '/industries',
        notes: n.valueProp || n.description || undefined,
      })
    }
  }
  const services = (schema.services ?? []).filter(s => s.name?.trim())
  if (services.length) {
    push({ url: '/services', title: 'Services', status: 'new', parent: '/' })
    for (const s of services) {
      push({
        url: `/services/${slugify(s.name)}`,
        title: s.name,
        status: 'new',
        parent: '/services',
        notes: s.description || undefined,
      })
    }
  }

  // Local-SEO pages. Only when the firm has structured service areas.
  const serviceAreas = (schema.business?.serviceAreas ?? []).filter(a => a.city?.trim())
  if (serviceAreas.length) {
    // Cities that already have a physical-location page must not get a duplicate
    // hub (the location's own /locations/<slug> page already covers them).
    const existingCitySlugs = new Set(
      (schema.locations ?? [])
        .map(l => l.city?.trim())
        .filter((c): c is string => !!c)
        .map(slugify),
    )

    // Location hubs: one /locations/<city-slug> per unique service-area city,
    // capped. Using /locations/<slug> means any city that coincides with a real
    // office is bound to its LocalBusiness node by json-ld-builder for free.
    const hubSlugs = new Set<string>()
    const seenAreaSlugs = new Set<string>()
    const uniqueAreas = serviceAreas.filter(a => {
      const s = slugify(a.city)
      if (!s || seenAreaSlugs.has(s)) return false
      seenAreaSlugs.add(s)
      return true
    })
    const hubAreas = rankAreas(
      uniqueAreas.filter(a => !existingCitySlugs.has(slugify(a.city))),
      LOCAL_HUB_CAP,
    )

    if (hubAreas.length) {
      push({ url: '/locations', title: 'Locations we serve', status: 'new', parent: '/' })
      for (const a of hubAreas) {
        const citySlug = slugify(a.city)
        hubSlugs.add(citySlug)
        push({
          url: `/locations/${citySlug}`,
          title: `${a.city.trim()} CPA`,
          status: 'new',
          parent: '/locations',
          notes: `Accounting in ${areaLabel(a)}.`,
        })
      }
    }

    // Service×geo pages: top services × primary areas that HAVE a hub (never a
    // service×geo for a city without a location hub). Capped on both axes.
    const geoServices = services.slice(0, LOCAL_SERVICE_CAP)
    const geoAreas = rankAreas(
      uniqueAreas.filter(a => hubSlugs.has(slugify(a.city))),
      LOCAL_AREA_CAP,
    )
    for (const s of geoServices) {
      const serviceSlug = slugify(s.name)
      for (const a of geoAreas) {
        push({
          url: `/services/${serviceSlug}-${slugify(a.city)}`,
          title: `${s.name} in ${areaLabel(a)}`,
          status: 'new',
          parent: `/services/${serviceSlug}`,
          notes: `${s.name} for businesses in ${areaLabel(a)}.`,
        })
      }
    }
  }

  return out.slice(0, MAX_PAGES)
}

// ── Validation (defensive coercion of the AI's JSON) ─────────────────────────
function validateProposal(parsed: unknown): ProposedSitemap | null {
  if (!Array.isArray(parsed)) return null
  const out: ProposedSitemap = []
  const seen = new Set<string>()
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const url = typeof r.url === 'string' ? r.url.trim() : ''
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    if (!url || !title) continue
    const key = normUrl(url)
    if (seen.has(key)) continue
    seen.add(key)
    const status: ProposedPage['status'] =
      r.status === 'new' || r.status === 'existing' ? r.status : 'update'
    const parent =
      typeof r.parent === 'string' && r.parent.trim() ? r.parent.trim() : undefined
    const notes =
      typeof r.notes === 'string' && r.notes.trim() ? r.notes.trim() : undefined
    out.push({ url, title, status, ...(parent ? { parent } : {}), ...(notes ? { notes } : {}) })
    if (out.length >= MAX_PAGES) break
  }
  return out.length ? out : null
}

// ── AI enrichment ────────────────────────────────────────────────────────────
function buildPrompt(schema: SessionSchema, skeleton: ProposedSitemap): string {
  const niches = (schema.niches ?? [])
    .filter(n => n.name?.trim())
    .map(n => `- ${n.name}: ${n.valueProp || n.painPoints || n.description || ''}`.trim())
    .join('\n')
  const services = (schema.services ?? [])
    .filter(s => s.name?.trim())
    .map(s => `- ${s.name}: ${s.description || ''}`.trim())
    .join('\n')
  const serviceAreas = (schema.business?.serviceAreas ?? [])
    .filter(a => a.city?.trim())
    .map(a => `- ${areaLabel(a)}${a.primary ? ' (primary)' : ''}`)
    .join('\n')
  const cg = schema.content_gaps
  const gaps = cg
    ? [
        cg.conversionGaps?.length ? `Conversion: ${cg.conversionGaps.slice(0, 6).join('; ')}` : '',
        cg.authorityGaps?.length ? `Authority: ${cg.authorityGaps.slice(0, 6).join('; ')}` : '',
      ].filter(Boolean).join('\n')
    : ''

  return `You are a website information architect for a CPA firm. Produce the rebuild SITEMAP for the new site as a hierarchical page list. Differentiate the firm with new niche/industry and service pages — do not just mirror the old site.

${buildFirmContext(schema)}

NICHES (each strong niche deserves its own landing page):
${niches || '(none specified)'}

SERVICES:
${services || '(none specified)'}

SERVICE AREAS (local-SEO geography — the firm serves these cities):
${serviceAreas || '(none specified)'}

SITE AUDIT — CONTENT GAPS TO FILL WITH NEW PAGES:
${gaps || '(none)'}

STARTING POINT (existing pages to keep as updates + a templated skeleton — refine, merge duplicates, and extend this; keep real existing URLs intact):
${JSON.stringify(skeleton, null, 2)}

OUTPUT FORMAT — JSON array only, no prose:
[
  { "url": "/services", "title": "Services", "status": "new", "parent": "/", "notes": "Optional one-line rationale (new pages only)." }
]

RULES:
- status: "update" for pages that already exist on the live site (keep their exact URL); "new" for pages to create.
- Build a real hierarchy via "parent" (a parent page's url, or "/" for top-level). Group service pages under a /services hub and industry/niche pages under an /industries hub.
- Propose a dedicated NEW page for each meaningful niche and core service, plus pages that fill the conversion/authority gaps above.
- LOCAL SEO: when service areas exist, KEEP the per-city location hubs (url "/locations/<city-slug>", parent "/locations") and the service×geo pages (url "/services/<service-slug>-<city-slug>", parent "/services/<service-slug>") from the skeleton. Do NOT invent extra geo pages beyond the skeleton's — thin/duplicate city pages are penalized as doorway pages. Never emit a service×geo page for a city that has no location hub.
- Every "new" page gets a one-line "notes" explaining why it differentiates the firm.
- URLs are lowercase slugs starting with "/". Titles are specific, benefit-driven, sentence case. No colons/parentheses/dashes in titles. No "Ultimate Guide", "Everything you need to know", "A Deep Dive", listicle titles.
- Keep the total under ${MAX_PAGES} pages. Return ONLY the JSON array.`
}

export async function proposeSitemap(
  schema: SessionSchema,
  auditResult: AuditResult | null = null,
  ctx?: Pick<TokenContext, 'sessionId' | 'contentJobId' | 'auditId'>
): Promise<ProposedSitemap> {
  const skeleton = buildSkeletonProposal(schema, auditResult)

  const enriched = await generateMbpJson<ProposedSitemap>(
    buildPrompt(schema, skeleton),
    validateProposal,
    6000,
    {
      task: 'content',
      stage: 'sitemap',
      sessionId: ctx?.sessionId,
      contentJobId: ctx?.contentJobId,
      auditId: ctx?.auditId,
    },
    { providerOptions: OUTLINE_PROVIDER_OPTIONS },
  )

  // Fall back to the deterministic skeleton on any generation/parse failure so
  // the admin never sees an empty or update-only sitemap.
  return enriched ?? skeleton
}
