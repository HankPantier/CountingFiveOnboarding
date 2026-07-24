// Intelligence-stage orchestrator. Runs the deterministic collectors and the
// AI/off-site research passes over a completed (in-memory) AuditResult and
// returns the assembled intelligence bundle. Best-effort throughout: each
// sub-section is independently try/caught so one failure never sinks the rest,
// and the whole stage is additionally guarded by the caller in runAudit().
import { buildCorpus } from '../corpus'
import { analyzeCompetitive } from './competitive'
import { analyzeCompetitors } from './competitors'
import { analyzeContentLibrary } from './content-library'
import { buildDigitalIntelligence } from './digital-intel'
import { detectDomainAge } from './domain-age'
import { analyzeNicheServices, hasNicheContent } from './niche-services'
import { buildNarrative } from './narrative'
import { buildSocialPresence } from './social-presence'
import { buildTeamSocial } from './team-social'
import { detectTechStack } from './tech-stack'
import type { TokenContext } from '@/lib/content/token-usage'
import type { AuditIntelligence, AuditResult, DetectedNiche } from '../types'

/** Run a builder, logging and swallowing any failure. Normalizes a null result
 * (a builder that ran but produced nothing) to undefined. A null is logged too,
 * so a silently-dropped section leaves a trace instead of just vanishing. */
async function safe<T>(
  label: string,
  fn: () => Promise<T> | T,
): Promise<NonNullable<T> | undefined> {
  try {
    const value = (await fn()) ?? undefined
    if (value === undefined) console.warn(`[audit-intelligence] ${label} produced no result`)
    return value
  } catch (err) {
    console.warn(`[audit-intelligence] ${label} failed:`, err)
    return undefined
  }
}

/** Best-effort "City, ST" from a free-text address, for Serper geo-biasing. */
function deriveLocation(result: AuditResult): string {
  for (const addr of result.business_signals?.addresses ?? []) {
    const m = addr.match(/,\s*([A-Za-z][A-Za-z .'-]+),\s*([A-Z]{2})\b/)
    if (m) return `${m[1].trim()}, ${m[2]}`
  }
  return ''
}

export async function buildIntelligence(
  result: AuditResult,
  attribution?: { sessionId?: string | null; auditId?: string | null },
): Promise<AuditIntelligence | undefined> {
  const intel: AuditIntelligence = {}
  const { pages } = buildCorpus(result)
  const siteName = result.site_name
  const location = deriveLocation(result)

  // Token attribution for every AI pass below — all are the 'audit' task.
  const tokenCtx: TokenContext = {
    task: 'audit',
    stage: 'audit',
    sessionId: attribution?.sessionId ?? null,
    auditId: attribution?.auditId ?? null,
  }

  // ── Deterministic collectors ──────────────────────────────────────────────
  intel.tech_stack = await safe('tech-stack', () => detectTechStack(result.raw?.pages ?? []))
  intel.domain = await safe('domain-age', () => detectDomainAge(result.domain, result.sitemap))

  // ── On-site AI analysis ───────────────────────────────────────────────────
  const niche = await safe('niche-services', () => analyzeNicheServices(pages, siteName, tokenCtx))
  if (niche) {
    intel.target_market = niche.target_market
    intel.niche_services = niche.niche_services
  }
  const detectedNiches: DetectedNiche[] = intel.niche_services?.detected_niches ?? []

  // ── Competitive + content library ─────────────────────────────────────────
  intel.competitive = await safe('competitive', () =>
    analyzeCompetitive({
      siteName,
      domain: result.domain,
      niches: detectedNiches,
      location,
      signals: {
        hasFaqSchema: result.findings.schema.has_faq,
        hasLlmsTxt: result.findings.ai_llm.llms_txt_present,
        hasLocalBusiness: result.findings.schema.has_local_business,
        aiCrawlersBlocked: result.findings.ai_llm.ai_crawlers_blocked,
      },
    }, tokenCtx),
  )
  intel.content_library = await safe('content-library', () => analyzeContentLibrary(result, tokenCtx))

  // Competitor firms (off-site discovery via Serper + LLM extraction) — fills
  // business.competitors, which audit-seeded sessions otherwise never get.
  intel.competitors = await safe('competitors', () =>
    analyzeCompetitors({ siteName, domain: result.domain, niches: detectedNiches, location }, tokenCtx),
  )

  // ── Off-site research ─────────────────────────────────────────────────────
  intel.digital_intelligence = await safe('digital-intelligence', () =>
    buildDigitalIntelligence({
      siteName,
      domain: result.domain,
      location,
      onSiteNiches: detectedNiches.map((n) => n.name),
    }, tokenCtx),
  )

  // Social & local presence — GBP + LinkedIn (required) + bonus channels, with
  // quality assessment. Runs before narrative so its gaps feed the AI prose.
  intel.social_presence = await safe('social-presence', () =>
    buildSocialPresence({
      siteName,
      domain: result.domain,
      location,
      socialLinks: result.business_signals?.socialLinks ?? [],
      addresses: result.business_signals?.addresses ?? [],
      onSiteNiches: detectedNiches.map((n) => n.name),
    }, tokenCtx),
  )

  // Team social footprint — per-member off-site presence + niche-expertise
  // mapping. Runs after digital-intelligence (whose personnel seed the roster)
  // and before narrative so the prose/recs can reference the team's gaps.
  intel.team_social = await safe('team-social', () =>
    buildTeamSocial({
      siteName,
      domain: result.domain,
      websiteUrl: result.url,
      location,
      onSiteNiches: detectedNiches.map((n) => n.name),
      personnelHint: intel.digital_intelligence?.personnel,
      knownUrls: result.page_analysis_summary?.map((p) => p.url) ?? [],
    }, tokenCtx),
  )

  // ── Narrative (LAST — consumes everything above) ──────────────────────────
  intel.narrative = await safe('narrative', () => buildNarrative(result, intel, tokenCtx))

  if (!nicheContentCaptured(intel)) {
    console.warn('[audit-intelligence] niche content NOT captured — the report will be missing its centerpiece section')
  }

  // Drop undefined keys; return undefined when nothing was produced.
  const cleaned: AuditIntelligence = {}
  for (const [k, v] of Object.entries(intel)) {
    if (v !== undefined && v !== null) cleaned[k as keyof AuditIntelligence] = v as never
  }
  return Object.keys(cleaned).length ? cleaned : undefined
}

/** True when the on-site niche & services section carries real content — the bar
 * the audit must clear to be considered a complete niche capture. Used to flag
 * (not fail) a run whose centerpiece section came back empty. */
export function nicheContentCaptured(intel: AuditIntelligence | undefined): boolean {
  return !!intel?.niche_services && hasNicheContent(intel.niche_services)
}

// Re-runs only the html-independent intelligence — social & local presence, then
// the narrative that consumes it — over an already-completed audit's stored
// result. Used by the "Refresh" action to add newer analysis WITHOUT re-crawling
// or re-scoring: the persisted result's raw HTML is stripped at storage time, so
// the crawl-dependent sub-sections (niche/services, tech stack, competitive) are
// preserved as-is rather than regenerated from empty pages. Everything else on
// the existing intelligence bundle is carried over untouched.
export async function refreshAuditIntelligence(
  result: AuditResult,
  attribution?: { sessionId?: string | null; auditId?: string | null },
): Promise<AuditIntelligence | undefined> {
  const intel: AuditIntelligence = { ...(result.intelligence ?? {}) }
  const siteName = result.site_name
  const location = deriveLocation(result)
  const tokenCtx: TokenContext = {
    task: 'audit',
    stage: 'audit',
    sessionId: attribution?.sessionId ?? null,
    auditId: attribution?.auditId ?? null,
  }
  const detectedNiches = intel.niche_services?.detected_niches ?? []

  // Each regenerated section falls back to its previously-stored value (`??
  // intel.<section>`) so a transient failure — a scrape that can't reach the
  // site this run, an AI hiccup — never silently WIPES a section that was
  // present before the refresh. A successful regeneration always replaces it.
  intel.social_presence =
    (await safe('social-presence', () =>
      buildSocialPresence({
        siteName,
        domain: result.domain,
        location,
        socialLinks: result.business_signals?.socialLinks ?? [],
        addresses: result.business_signals?.addresses ?? [],
        onSiteNiches: detectedNiches.map((n) => n.name),
      }, tokenCtx),
    )) ?? intel.social_presence

  // Team social footprint — re-scraped fresh (refresh has no stored raw HTML),
  // so it regenerates without a full re-crawl. Uses the carried-over personnel.
  intel.team_social =
    (await safe('team-social', () =>
      buildTeamSocial({
        siteName,
        domain: result.domain,
        websiteUrl: result.url,
        location,
        onSiteNiches: detectedNiches.map((n) => n.name),
        personnelHint: intel.digital_intelligence?.personnel,
        knownUrls: result.page_analysis_summary?.map((p) => p.url) ?? [],
      }, tokenCtx),
    )) ?? intel.team_social

  // Re-run the narrative so the report's "Recommendations & Next Steps" reflects
  // the refreshed social/local gaps (consumes the whole bundle; needs no HTML).
  intel.narrative = (await safe('narrative', () => buildNarrative(result, intel, tokenCtx))) ?? intel.narrative

  const cleaned: AuditIntelligence = {}
  for (const [k, v] of Object.entries(intel)) {
    if (v !== undefined && v !== null) cleaned[k as keyof AuditIntelligence] = v as never
  }
  return Object.keys(cleaned).length ? cleaned : undefined
}
