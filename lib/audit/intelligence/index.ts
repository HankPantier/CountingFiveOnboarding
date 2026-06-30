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
import { analyzeNicheServices } from './niche-services'
import { buildNarrative } from './narrative'
import { detectTechStack } from './tech-stack'
import type { TokenContext } from '@/lib/content/token-usage'
import type { AuditIntelligence, AuditResult, DetectedNiche } from '../types'

/** Run a builder, logging and swallowing any failure. Normalizes a null result
 * (a builder that ran but produced nothing) to undefined. */
async function safe<T>(
  label: string,
  fn: () => Promise<T> | T,
): Promise<NonNullable<T> | undefined> {
  try {
    return (await fn()) ?? undefined
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

  // ── Narrative (LAST — consumes everything above) ──────────────────────────
  intel.narrative = await safe('narrative', () => buildNarrative(result, intel, tokenCtx))

  // Drop undefined keys; return undefined when nothing was produced.
  const cleaned: AuditIntelligence = {}
  for (const [k, v] of Object.entries(intel)) {
    if (v !== undefined && v !== null) cleaned[k as keyof AuditIntelligence] = v as never
  }
  return Object.keys(cleaned).length ? cleaned : undefined
}
