// AI narrative layer — runs LAST, after every other intelligence sub-section.
// Given the deterministic scores/findings plus the assembled intelligence, Claude
// writes the executive summary, per-section commentary (keyed by section id), and
// the business-framed "CountingFive Can Help" recommendations. Grounded strictly
// in the structured inputs passed in — no new facts.
import { generateMbpJson } from '@/lib/mbp/generate-json'
import { CATEGORY_META } from '../report-format'
import type {
  AuditIntelligence,
  AuditResult,
  NarrativeIntelligence,
  NarrativePriority,
  NarrativeRecommendation,
} from '../types'

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const asObjArr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

function asPriority(v: unknown): NarrativePriority {
  const s = asStr(v).toLowerCase()
  return s === 'high' ? 'High' : s === 'low' ? 'Low' : 'Medium'
}

/** Compact, token-lean snapshot of everything the narrative should speak to. */
function buildContext(result: AuditResult, intel: AuditIntelligence): string {
  const cats = CATEGORY_META.map((c) => {
    const cs = result.category_scores[c.key]
    return `- ${c.key} (${c.label}): ${cs?.score ?? 'N/A'}${cs?.grade ? ` / ${cs.grade}` : ''}`
  }).join('\n')

  const lines: string[] = [
    `Site: ${result.site_name} (${result.domain})`,
    `Overall: ${result.overall_score} / ${result.overall_grade}`,
    `Pages crawled: ${result.pages_crawled}`,
    '',
    'Deterministic category scores:',
    cats,
  ]

  if (intel.target_market) lines.push('', `Target Market Clarity: ${intel.target_market.score}/100 — ${intel.target_market.commentary}`)
  if (intel.niche_services) {
    lines.push(
      '',
      `Niche & Services: ${intel.niche_services.score}/100`,
      `Detected niches: ${intel.niche_services.detected_niches.map((n) => `${n.name} (${n.signal})`).join(', ') || 'none'}`,
      `Invisible niches: ${intel.niche_services.invisible_niches.map((n) => n.name).join(', ') || 'none'}`,
      `Top improvements: ${intel.niche_services.top_improvements.join('; ') || 'none'}`,
    )
  }
  if (intel.competitive) {
    lines.push(
      '',
      `Competitive search: ${intel.competitive.score}/100`,
      `Rankings: ${intel.competitive.keyword_rankings.map((k) => `${k.keyword}=${k.rank ?? 'NR'}`).join(', ')}`,
      `AI search: ${intel.competitive.ai_search_presence}`,
    )
  }
  if (intel.tech_stack) {
    lines.push('', `Tech stack: CMS=${intel.tech_stack.cms ?? '?'}, hosting=${intel.tech_stack.hosting ?? '?'}, frameworks=${intel.tech_stack.frameworks.join('/') || '?'}, risks=${intel.tech_stack.risk_flags.join('; ') || 'none'}`)
  }
  if (intel.domain) lines.push('', `Domain: registered ${intel.domain.registered ?? '?'} (~${intel.domain.age_years ?? '?'} yrs), last content update ${intel.domain.last_updated ?? '?'}`)
  if (intel.content_library) lines.push('', `Content library: ${intel.content_library.total_pieces} pieces. ${intel.content_library.syndication_assessment}`)
  if (intel.digital_intelligence) {
    const di = intel.digital_intelligence
    lines.push(
      '',
      `Digital intelligence: sentiment ${di.reputation.sentiment}; ratings ${di.reputation.ratings.join(', ') || 'none'}`,
      `Personnel: ${di.personnel.map((p) => `${p.name} (${p.footprint})`).join(', ') || 'none'}`,
      `Unleveraged credibility: ${di.niche_gap.unleveraged.join('; ') || 'none'}`,
    )
  }
  return lines.join('\n')
}

function sectionIds(intel: AuditIntelligence): string[] {
  const ids = CATEGORY_META.map((c) => c.key) as string[]
  if (intel.target_market) ids.push('target_market')
  if (intel.niche_services) ids.push('niche_services')
  if (intel.competitive) ids.push('competitive')
  if (intel.tech_stack) ids.push('tech_stack')
  if (intel.content_library) ids.push('content_library')
  if (intel.digital_intelligence) ids.push('digital_intelligence')
  return ids
}

function validate(parsed: unknown): NarrativeIntelligence | null {
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  const executive_summary = asStr(p.executive_summary)

  const section_commentary: Record<string, string> = {}
  if (p.section_commentary && typeof p.section_commentary === 'object') {
    for (const [k, v] of Object.entries(p.section_commentary as Record<string, unknown>)) {
      const text = asStr(v)
      if (text) section_commentary[k] = text
    }
  }

  const recommendations: NarrativeRecommendation[] = asObjArr(p.recommendations).map((r) => ({
    title: asStr(r.title),
    business_impact: asStr(r.business_impact),
    counting_five_help: asStr(r.counting_five_help),
    priority: asPriority(r.priority),
  })).filter((r) => r.title)

  if (!executive_summary && !Object.keys(section_commentary).length && !recommendations.length) return null
  return { executive_summary, section_commentary, recommendations }
}

export async function buildNarrative(
  result: AuditResult,
  intel: AuditIntelligence,
): Promise<NarrativeIntelligence | null> {
  const ids = sectionIds(intel)
  const prompt = `You are writing the narrative of a website audit report for "${result.site_name}". Use ONLY the structured findings below — do not invent metrics or facts. Write for a business owner, not a developer: clear, specific, jargon-free, addressed to the firm as "you/your".

Return JSON:
{
  "executive_summary": "1 paragraph (4-7 sentences): the site's real strengths, the 2-3 things holding it back, and the business upside of fixing them",
  "section_commentary": { ${ids.map((id) => `"${id}": "2-4 sentences on this section"`).join(', ')} },
  "recommendations": [ { "title": string, "business_impact": "why it matters in business terms", "counting_five_help": "how CountingFive can help", "priority": "High|Medium|Low" } ]
}
Provide 4-6 recommendations, ordered most-impactful first. Return only the JSON.

STRUCTURED FINDINGS:
${buildContext(result, intel)}`

  return generateMbpJson<NarrativeIntelligence>(prompt, validate, 4000)
}
