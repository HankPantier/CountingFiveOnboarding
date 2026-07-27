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

// Overall wall-clock budget for the whole intelligence stage. The pre-stage work
// (crawl + PageSpeed) has already consumed part of the route's 300s maxDuration,
// so intelligence is capped and DEGRADES to a partial bundle rather than letting
// a slow site run the function past its limit and get swept to 'error' by cron.
const INTELLIGENCE_BUDGET_MS = 180_000

// safe() plus an overall-deadline race. If the budget is already spent the
// section is skipped without starting; otherwise it runs but can't push past the
// deadline — a timed-out section resolves to undefined and its background work is
// abandoned when the function returns. This is what lets the audit COMPLETE with
// partial intel instead of overrunning maxDuration. Sections are otherwise run in
// dependency-ordered PARALLEL stages (below), so per-section timeouts rarely bite.
async function budgeted<T>(
  label: string,
  deadline: number,
  fn: () => Promise<T> | T,
): Promise<NonNullable<T> | undefined> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) {
    console.warn(`[audit-intelligence] ${label} skipped — intelligence budget exhausted`)
    return undefined
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[audit-intelligence] ${label} exceeded remaining budget (~${Math.round(remaining / 1000)}s) — using partial`)
      resolve(undefined)
    }, remaining)
  })
  const value = await Promise.race([safe(label, fn), timeout])
  if (timer) clearTimeout(timer)
  return value
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

  // The stage is budget-bounded (see budgeted()/INTELLIGENCE_BUDGET_MS) and runs
  // in four dependency-ordered PARALLEL waves — previously all ~10 passes ran
  // strictly sequentially, whose summed wall-time overran the route's 300s limit
  // once Serper off-site discovery went live.
  const deadline = Date.now() + INTELLIGENCE_BUDGET_MS

  // ── Stage A: deterministic collectors + on-site niche (feeds later stages) ──
  const [techStack, domainAge, contentLibrary, niche] = await Promise.all([
    budgeted('tech-stack', deadline, () => detectTechStack(result.raw?.pages ?? [])),
    budgeted('domain-age', deadline, () => detectDomainAge(result.domain, result.sitemap)),
    budgeted('content-library', deadline, () => analyzeContentLibrary(result, tokenCtx)),
    budgeted('niche-services', deadline, () => analyzeNicheServices(pages, siteName, tokenCtx)),
  ])
  intel.tech_stack = techStack
  intel.domain = domainAge
  intel.content_library = contentLibrary
  if (niche) {
    intel.target_market = niche.target_market
    intel.niche_services = niche.niche_services
  }
  const detectedNiches: DetectedNiche[] = intel.niche_services?.detected_niches ?? []

  // ── Stage B: niche-dependent research (independent of one another) ──────────
  const [competitive, competitors, digitalIntelligence, socialPresence] = await Promise.all([
    budgeted('competitive', deadline, () =>
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
    ),
    // Competitor firms (off-site discovery via Serper + LLM extraction) — fills
    // business.competitors, which audit-seeded sessions otherwise never get.
    budgeted('competitors', deadline, () =>
      analyzeCompetitors({ siteName, domain: result.domain, niches: detectedNiches, location }, tokenCtx),
    ),
    budgeted('digital-intelligence', deadline, () =>
      buildDigitalIntelligence({
        siteName,
        domain: result.domain,
        location,
        onSiteNiches: detectedNiches.map((n) => n.name),
      }, tokenCtx),
    ),
    // Social & local presence — GBP + LinkedIn (required) + bonus channels, with
    // quality assessment. Feeds the narrative's prose in Stage D.
    budgeted('social-presence', deadline, () =>
      buildSocialPresence({
        siteName,
        domain: result.domain,
        location,
        socialLinks: result.business_signals?.socialLinks ?? [],
        addresses: result.business_signals?.addresses ?? [],
        onSiteNiches: detectedNiches.map((n) => n.name),
      }, tokenCtx),
    ),
  ])
  intel.competitive = competitive
  intel.competitors = competitors
  intel.digital_intelligence = digitalIntelligence
  intel.social_presence = socialPresence

  // ── Stage C: team social footprint — needs digital-intel's personnel seed ───
  // per-member off-site presence + niche-expertise mapping.
  intel.team_social = await budgeted('team-social', deadline, () =>
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

  // ── Stage D: narrative (LAST — consumes everything above) ──────────────────
  intel.narrative = await budgeted('narrative', deadline, () => buildNarrative(result, intel, tokenCtx))

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
