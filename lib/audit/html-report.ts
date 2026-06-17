// Standalone, shareable HTML report. Renders the stored AuditResult into a
// self-contained HTML document (inline CSS, Revaltus palette, no app/Tailwind
// dependency) that an admin can download and email to a client. The hex values
// here are intentional: a standalone file can't reference the app's design
// tokens, so the Revaltus palette is inlined in one <style> block.
import {
  CATEGORY_META,
  findingRows,
  gradeToken,
  safeHref,
  type SemanticToken,
} from './report-format'
import { SECTION_HELP, SECTION_LABELS, intelScorePct, signalLabel, subScoreRows } from './intelligence-format'
import type {
  AuditIntelligence,
  AuditResult,
  CategoryScoreMap,
  CompetitiveIntelligence,
  ContentLibraryIntelligence,
  DigitalIntelligence,
  DomainIntelligence,
  Grade,
  NarrativeIntelligence,
  NicheServicesIntelligence,
  PageSummary,
  Recommendation,
  ScoredSection,
  TechStackIntelligence,
} from './types'

const COLORS = {
  navy: '#231f20',
  cyan: '#098195',
  page: '#F8FAFC',
  card: '#FFFFFF',
  subtle: '#F1F5F9',
  border: '#E2E8F0',
  textPrimary: '#1E293B',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  success: '#098195',
  warning: '#F59E0B',
  warningText: '#92400E', // amber-800 — readable warning text (AA)
  error: '#6B2956',
}

const TOKEN_COLOR: Record<SemanticToken, string> = {
  success: COLORS.success,
  warning: COLORS.warning,
  error: COLORS.error,
  muted: COLORS.textMuted,
}

// Readable foreground for a chip whose fill is `bg`: amber needs a darker text.
const chipText = (bg: string): string => (bg === COLORS.warning ? COLORS.warningText : bg)

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function gradeChip(grade: Grade | null, score: number | null): string {
  if (grade === null || score === null) {
    return `<span class="chip" style="background:${COLORS.subtle};color:${COLORS.textMuted}">N/A</span>`
  }
  const c = TOKEN_COLOR[gradeToken(grade)]
  return `<span class="chip" style="background:${c}1a;color:${chipText(c)}">${esc(grade)} · ${score}</span>`
}

function scoreRingSvg(score: number, grade: Grade): string {
  const size = 160
  const stroke = 12
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circ
  const color = TOKEN_COLOR[gradeToken(grade)]
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Overall score ${score} out of 100, grade ${esc(grade)}">
    <title>Overall score ${score} out of 100, grade ${esc(grade)}</title>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${COLORS.border}" stroke-width="${stroke}" />
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${dash} ${circ - dash}" transform="rotate(-90 ${size / 2} ${size / 2})" />
    <text x="50%" y="46%" text-anchor="middle" font-size="42" font-weight="700" fill="${COLORS.textPrimary}" font-family="Inter,sans-serif">${score}</text>
    <text x="50%" y="64%" text-anchor="middle" font-size="14" font-weight="600" fill="${COLORS.textSecondary}" font-family="Inter,sans-serif">Grade ${esc(grade)}</text>
  </svg>`
}

function deltaCell(current: number | null, previous: number | null): string {
  if (current === null || previous === null || current === previous) {
    return `<span style="color:${COLORS.textMuted};font-size:12px">—</span>`
  }
  const diff = current - previous
  const up = diff > 0
  const color = up ? COLORS.success : COLORS.error
  return `<span style="color:${color};font-weight:600;font-size:13px">${up ? '▲' : '▼'} ${Math.abs(diff)}</span>`
}

// ── Intelligence-layer rendering ─────────────────────────────────────────────

function commentaryHtml(text: string | undefined): string {
  return text ? `<p class="muted" style="margin-top:12px">${esc(text)}</p>` : ''
}

function subScoresHtml(sub: Record<string, number>): string {
  const rows = subScoreRows(sub)
  if (!rows.length) return ''
  return `<dl class="findings">${rows
    .map((r) => `<div class="finding"><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`)
    .join('')}</dl>`
}

// lucide `Info` icon, inlined to match the in-app report's header tooltip.
const INFO_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'

/** Collapsible section. `chip` is the grade chip HTML (empty for unscored
 * sections); `tip` is the header tooltip text. Native <details> + CSS-only
 * tooltip — no JS, print-friendly. */
function accordion(label: string, chip: string, body: string, tip?: string): string {
  const tipHtml = tip
    ? `<span class="tip" tabindex="0">${INFO_SVG}<span class="tip-bubble" role="tooltip">${esc(tip)}</span></span>`
    : ''
  return `<details class="card acc">
    <summary class="acc-head"><span class="acc-label"><h3>${esc(label)}</h3>${tipHtml}</span><span class="acc-right">${chip}<span class="chev" aria-hidden="true">▾</span></span></summary>
    <div class="acc-body">${body}</div>
  </details>`
}

function scoreBar(pct: number, grade: Grade | null): string {
  const color = TOKEN_COLOR[gradeToken(grade)]
  const w = Math.max(0, Math.min(100, pct))
  return `<div class="bar"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div>`
}

function targetMarketBody(s: ScoredSection, commentary?: string): string {
  return `${subScoresHtml(s.sub_scores)}${commentaryHtml(s.commentary)}${commentaryHtml(commentary)}`
}

function nicheServicesBody(n: NicheServicesIntelligence, commentary?: string): string {
  const detected = n.detected_niches.length
    ? `<h4 class="intel-sub">Detected Niches</h4><ul class="intel-list">${n.detected_niches
        .map((d) => `<li><strong>${esc(d.name)}</strong> <span class="small">(${esc(signalLabel(d.signal))})</span> — ${esc(d.note)}</li>`)
        .join('')}</ul>`
    : ''
  const invisible = n.invisible_niches.length
    ? `<h4 class="intel-sub">Invisible but High-Opportunity Niches</h4><ul class="intel-list">${n.invisible_niches
        .map((d) => `<li><strong>${esc(d.name)}</strong> — ${esc(d.opportunity)}</li>`)
        .join('')}</ul>`
    : ''
  const services = n.services_analysis.length
    ? `<h4 class="intel-sub">Services Communication Analysis</h4>
      <div class="table-wrap"><table>
        <thead><tr>${['Service', 'Clarity', 'Framing', 'Audience', 'Rewrite Direction']
          .map((h) => `<th>${h}</th>`)
          .join('')}</tr></thead>
        <tbody>${n.services_analysis
          .map(
            (s) => `<tr><td>${esc(s.service)}</td><td>${esc(s.clarity)}</td><td>${esc(s.framing)}</td><td>${esc(s.audience)}</td><td>${esc(s.rewrite_direction)}</td></tr>`,
          )
          .join('')}</tbody>
      </table></div>`
    : ''
  const improvements = n.top_improvements.length
    ? `<h4 class="intel-sub">Top Highest-Impact Improvements</h4><ol class="intel-list">${n.top_improvements
        .map((i) => `<li>${esc(i)}</li>`)
        .join('')}</ol>`
    : ''
  return `${subScoresHtml(n.sub_scores)}
    ${commentaryHtml(n.commentary)}
    ${commentaryHtml(commentary)}
    ${detected}${invisible}${services}${improvements}`
}

function competitiveBody(c: CompetitiveIntelligence, commentary?: string): string {
  const ranks = c.keyword_rankings.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Keyword</th><th>Rank</th><th>Note</th></tr></thead>
        <tbody>${c.keyword_rankings
          .map(
            (k) => `<tr><td>${esc(k.keyword)}</td><td>${k.rank === null ? '—' : `#${k.rank}`}</td><td>${esc(k.note)}</td></tr>`,
          )
          .join('')}</tbody>
      </table></div>`
    : ''
  const judged = [
    c.local_seo ? `<p class="muted" style="margin-top:12px"><strong>Local SEO:</strong> ${esc(c.local_seo)}</p>` : '',
    c.ai_search_presence ? `<p class="muted" style="margin-top:8px"><strong>AI Search:</strong> ${esc(c.ai_search_presence)}</p>` : '',
  ].join('')
  return `${subScoresHtml(c.sub_scores)}
    ${ranks}
    ${commentaryHtml(c.commentary)}
    ${judged}
    ${commentaryHtml(commentary)}`
}

function techDomainBody(
  tech: TechStackIntelligence | undefined,
  domain: DomainIntelligence | undefined,
  commentary?: string,
): string {
  const rows: Array<[string, string]> = []
  if (tech) {
    if (tech.cms) rows.push(['CMS', tech.cms])
    if (tech.page_builder) rows.push(['Page Builder', tech.page_builder])
    if (tech.hosting) rows.push(['Hosting / CDN', tech.hosting])
    if (tech.frameworks.length) rows.push(['Frameworks', tech.frameworks.join(', ')])
  }
  if (domain) {
    if (domain.registered) rows.push(['Domain Registered', domain.registered])
    if (domain.age_years !== null) rows.push(['Domain Age', `${domain.age_years} years`])
    if (domain.last_updated) rows.push(['Last Content Update', domain.last_updated])
  }
  const rowsHtml = rows.length
    ? `<dl class="findings">${rows
        .map(([k, v]) => `<div class="finding"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
        .join('')}</dl>`
    : ''
  const risks = tech?.risk_flags.length
    ? `<h4 class="intel-sub">Flags</h4><ul class="intel-list">${tech.risk_flags
        .map((r) => `<li style="color:${COLORS.error}">${esc(r)}</li>`)
        .join('')}</ul>`
    : ''
  return `${rowsHtml}${risks}
    ${commentaryHtml(tech?.commentary)}
    ${commentaryHtml(commentary)}`
}

function contentLibraryBody(c: ContentLibraryIntelligence, commentary?: string): string {
  const formats = c.formats.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Format</th><th>Count</th><th>Cadence</th></tr></thead>
        <tbody>${c.formats
          .map((f) => `<tr><td>${esc(f.type)}</td><td>${f.count}</td><td>${esc(f.cadence)}</td></tr>`)
          .join('')}</tbody>
      </table></div>`
    : ''
  const recs = c.recommendations.length
    ? `<h4 class="intel-sub">Recommendations</h4><ul class="intel-list">${c.recommendations
        .map((r) => `<li>${esc(r)}</li>`)
        .join('')}</ul>`
    : ''
  return `<p class="muted small">${c.total_pieces} published piece${c.total_pieces === 1 ? '' : 's'}</p>
    ${formats}
    ${commentaryHtml(c.syndication_assessment)}
    ${recs}
    ${commentaryHtml(commentary)}`
}

function digitalIntelBody(d: DigitalIntelligence, commentary?: string): string {
  const personnel = d.personnel.length
    ? `<h4 class="intel-sub">Key Personnel</h4>${d.personnel
        .map(
          (p) => `<div class="intel-person">
            <div><strong>${esc(p.name)}</strong> · ${esc(p.role)} <span class="small">(${esc(p.footprint)} footprint)</span></div>
            ${p.associations.length ? `<div class="small">Associations: ${esc(p.associations.join(', '))}</div>` : ''}
            ${p.notes ? `<div class="muted">${esc(p.notes)}</div>` : ''}
          </div>`,
        )
        .join('')}`
    : ''
  const rep = d.reputation
  const reputation =
    rep.sentiment || rep.ratings.length || rep.praise_themes.length || rep.concern_themes.length
      ? `<h4 class="intel-sub">Reputation Signals</h4>
        <dl class="findings">
          ${rep.sentiment ? `<div class="finding"><dt>Sentiment</dt><dd>${esc(rep.sentiment)}</dd></div>` : ''}
          ${rep.ratings.length ? `<div class="finding"><dt>Ratings</dt><dd>${esc(rep.ratings.join(', '))}</dd></div>` : ''}
          ${rep.praise_themes.length ? `<div class="finding"><dt>Praise</dt><dd>${esc(rep.praise_themes.join(', '))}</dd></div>` : ''}
          ${rep.concern_themes.length ? `<div class="finding"><dt>Concerns</dt><dd>${esc(rep.concern_themes.join(', '))}</dd></div>` : ''}
        </dl>`
      : ''
  const affiliations = d.affiliations.length
    ? `<h4 class="intel-sub">Affiliations</h4><ul class="intel-list">${d.affiliations
        .map((a) => `<li>${esc(a)}</li>`)
        .join('')}</ul>`
    : ''
  const footprint = d.content_footprint.length
    ? `<h4 class="intel-sub">Content Footprint</h4>
      <div class="table-wrap"><table>
        <thead><tr><th>Type</th><th>Title</th><th>Source</th></tr></thead>
        <tbody>${d.content_footprint
          .map((f) => `<tr><td>${esc(f.type)}</td><td>${esc(f.title)}</td><td>${esc(f.source)}</td></tr>`)
          .join('')}</tbody>
      </table></div>`
    : ''
  const social = d.social_presence.length
    ? `<h4 class="intel-sub">Social Media Presence</h4><ul class="intel-list">${d.social_presence
        .map((s) => `<li><strong>${esc(s.platform)}</strong> — ${esc(s.status)}${s.detail ? ` · ${esc(s.detail)}` : ''}</li>`)
        .join('')}</ul>`
    : ''
  const gap = d.niche_gap
  const gapHtml = gap.external.length || gap.on_site.length || gap.unleveraged.length
    ? `<h4 class="intel-sub">External vs. Website Niche Gap</h4>
       ${gap.on_site.length ? `<p class="muted"><strong>On website:</strong> ${esc(gap.on_site.join(', '))}</p>` : ''}
       ${gap.external.length ? `<p class="muted"><strong>Found externally:</strong> ${esc(gap.external.join(', '))}</p>` : ''}
       ${gap.unleveraged.length ? `<ul class="intel-list">${gap.unleveraged.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : ''}`
    : ''
  return `<p class="muted small">External research — not scored</p>
    ${personnel}${reputation}${affiliations}${footprint}${social}${gapHtml}
    ${commentaryHtml(commentary)}`
}

const NARRATIVE_PRIORITY_COLOR: Record<string, string> = {
  High: COLORS.error,
  Medium: COLORS.warning,
  Low: COLORS.success,
}

function narrativeRecsBody(narrative: NarrativeIntelligence): string {
  return `<ul class="recs">${narrative.recommendations
    .map((r) => {
      const c = NARRATIVE_PRIORITY_COLOR[r.priority] ?? COLORS.warning
      return `<li class="rec">
          <div class="rec-head">
            <span class="chip" style="background:${c}1a;color:${chipText(c)}">${esc(r.priority)} priority</span>
          </div>
          <div class="rec-title">${esc(r.title)}</div>
          ${r.business_impact ? `<div class="muted"><strong>Business impact:</strong> ${esc(r.business_impact)}</div>` : ''}
          ${r.counting_five_help ? `<div class="muted" style="margin-top:4px"><strong>How we help:</strong> ${esc(r.counting_five_help)}</div>` : ''}
        </li>`
    })
    .join('')}</ul>`
}

/** The three strategic scored sections as accordions, in the order they lead
 * the report — ahead of the deterministic technical categories. */
function intelLeadAccordions(intel: AuditIntelligence): string {
  const c = intel.narrative?.section_commentary ?? {}
  const parts: string[] = []
  if (intel.target_market) {
    parts.push(
      accordion(
        SECTION_LABELS.target_market,
        gradeChip(intel.target_market.grade, intel.target_market.score),
        targetMarketBody(intel.target_market, c.target_market),
        SECTION_HELP.target_market,
      ),
    )
  }
  if (intel.competitive) {
    parts.push(
      accordion(
        SECTION_LABELS.competitive,
        gradeChip(intel.competitive.grade, intel.competitive.score),
        competitiveBody(intel.competitive, c.competitive),
        SECTION_HELP.competitive,
      ),
    )
  }
  if (intel.niche_services) {
    parts.push(
      accordion(
        SECTION_LABELS.niche_services,
        gradeChip(intel.niche_services.grade, intel.niche_services.score),
        nicheServicesBody(intel.niche_services, c.niche_services),
        SECTION_HELP.niche_services,
      ),
    )
  }
  return parts.join('')
}

/** Technology Stack & Domain accordion (unscored — no grade chip). */
function techDomainAccordion(intel: AuditIntelligence): string {
  if (!intel.tech_stack && !intel.domain) return ''
  const c = intel.narrative?.section_commentary ?? {}
  return accordion(
    `${SECTION_LABELS.tech_stack} & Domain`,
    '',
    techDomainBody(intel.tech_stack, intel.domain, c.tech_stack),
    SECTION_HELP.tech_stack,
  )
}

function topRecommendationsHtml(
  items: Array<{ title: string; detail: string; color: string }>,
): string {
  if (!items.length) return ''
  return `<div class="top-recs">
    <h3>Top Recommendations</h3>
    <ul>${items
      .map(
        (it) =>
          `<li><span class="dot" style="background:${it.color}"></span><span><strong>${esc(it.title)}</strong>${it.detail ? ` — ${esc(it.detail)}` : ''}</span></li>`,
      )
      .join('')}</ul>
  </div>`
}

function ctaBoxHtml(): string {
  return `<section class="cta">
    <h2>Ready to turn these findings into results?</h2>
    <p>Revaltus turns audit insights into a prioritized plan — plus the content, technical fixes, and search-visibility work to execute it.</p>
    <a class="cta-btn" href="https://revaltus.com">Let&rsquo;s talk</a>
  </section>`
}

export interface BuildAuditHtmlInput {
  result: AuditResult
  createdAt: string
  previous?: { overall_score: number | null; category_scores: CategoryScoreMap | null } | null
}

export function buildAuditHtml({ result, createdAt, previous }: BuildAuditHtmlInput): string {
  const runDate = new Date(createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const criticals = result.recommendations.filter((r) => r.priority === 'critical')
  const intel = result.intelligence
  const execProse = intel?.narrative?.executive_summary

  // Top Recommendations — prefer business-framed narrative recs, else criticals.
  const narrativeColor = (p: string): string => NARRATIVE_PRIORITY_COLOR[p] ?? COLORS.warning
  const topRecs = intel?.narrative?.recommendations?.length
    ? intel.narrative.recommendations
        .slice(0, 3)
        .map((r) => ({ title: r.title, detail: r.business_impact, color: narrativeColor(r.priority) }))
    : criticals.slice(0, 3).map((r) => ({ title: r.title, detail: r.detail, color: COLORS.error }))

  const summarySection = `
    <section class="card exec">
      <div class="ring">${scoreRingSvg(result.overall_score, result.overall_grade)}</div>
      <div class="exec-body">
        <h2>Executive Summary</h2>
        <p class="muted">${result.pages_crawled} page${result.pages_crawled === 1 ? '' : 's'} crawled ·
          ${criticals.length} critical issue${criticals.length === 1 ? '' : 's'} ·
          ${result.recommendations.length} total recommendations</p>
        ${execProse ? `<p style="margin-top:12px">${esc(execProse)}</p>` : ''}
        ${topRecommendationsHtml(topRecs)}
      </div>
    </section>`

  // Score dashboard — strategic intelligence sections lead, then the
  // deterministic categories. Intel scores (0–10) normalize to a 0–100 bar.
  type DashCard = { label: string; grade: Grade | null; score: number | null; pct: number }
  const dashCards: DashCard[] = [
    ...(intel?.target_market
      ? [{ label: SECTION_LABELS.target_market, grade: intel.target_market.grade, score: intel.target_market.score, pct: intelScorePct(intel.target_market.score) }]
      : []),
    ...(intel?.competitive
      ? [{ label: SECTION_LABELS.competitive, grade: intel.competitive.grade, score: intel.competitive.score, pct: intelScorePct(intel.competitive.score) }]
      : []),
    ...(intel?.niche_services
      ? [{ label: SECTION_LABELS.niche_services, grade: intel.niche_services.grade, score: intel.niche_services.score, pct: intelScorePct(intel.niche_services.score) }]
      : []),
    ...CATEGORY_META.map(({ key, label }) => {
      const cs = result.category_scores[key]
      return { label, grade: cs.grade, score: cs.score, pct: cs.score ?? 0 }
    }),
  ]

  const dashGrid = `<div class="grid">${dashCards
    .map(
      (c) => `<div class="dash">
        <div class="dash-top"><div class="grid-label">${esc(c.label)}</div>${gradeChip(c.grade, c.score)}</div>
        ${scoreBar(c.pct, c.grade)}
      </div>`,
    )
    .join('')}</div>`
  const dashboardSection = accordion('Score Dashboard', '', dashGrid, SECTION_HELP.dashboard)

  const deltaSection = previous
    ? accordion(
        'Change Since Last Audit',
        '',
        `<div class="grid">
          <div class="grid-item strong"><div class="grid-label">Overall</div>${deltaCell(result.overall_score, previous.overall_score)}</div>
          ${CATEGORY_META.map(({ key, label }) => {
            return `<div class="grid-item"><div class="grid-label">${esc(label)}</div>${deltaCell(
              result.category_scores[key].score,
              previous.category_scores?.[key]?.score ?? null,
            )}</div>`
          }).join('')}
        </div>`,
        SECTION_HELP.change,
      )
    : ''

  const sectionCommentary = intel?.narrative?.section_commentary ?? {}
  const categoryAccordions = CATEGORY_META.map(({ key, label }) => {
    const cs = result.category_scores[key]
    const rows = findingRows(result.findings[key])
    const findings = rows.length
      ? `<dl class="findings">${rows
          .map((row) => `<div class="finding"><dt>${esc(row.label)}</dt><dd>${esc(row.value)}</dd></div>`)
          .join('')}</dl>`
      : ''
    return accordion(label, gradeChip(cs.grade, cs.score), `${findings}${commentaryHtml(sectionCommentary[key])}`, SECTION_HELP[key])
  }).join('')

  // Every section is a collapsible accordion, same order as the dashboard:
  // intelligence leads, then categories, then tech/domain.
  const sectionDetails = `
    ${intel ? intelLeadAccordions(intel) : ''}
    ${categoryAccordions}
    ${intel ? techDomainAccordion(intel) : ''}`

  const contentLibrarySection = intel?.content_library
    ? accordion(
        SECTION_LABELS.content_library,
        '',
        contentLibraryBody(intel.content_library, sectionCommentary.content_library),
        SECTION_HELP.content_library,
      )
    : ''
  const digitalIntelSection = intel?.digital_intelligence
    ? accordion(
        SECTION_LABELS.digital_intelligence,
        '',
        digitalIntelBody(intel.digital_intelligence, sectionCommentary.digital_intelligence),
        SECTION_HELP.digital_intelligence,
      )
    : ''
  const narrativeRecsSection = intel?.narrative?.recommendations?.length
    ? accordion('Recommendations & Next Steps', '', narrativeRecsBody(intel.narrative), SECTION_HELP.narrative_recs)
    : ''

  const inventoryInner = `<p class="muted small">${result.page_analysis_summary.length} pages analyzed</p>
      <div class="table-wrap"><table>
        <thead><tr>${['URL', 'Title', 'Status', 'H1', 'Schema', 'Words', 'Issues']
          .map((h) => `<th>${h}</th>`)
          .join('')}</tr></thead>
        <tbody>${result.page_analysis_summary
          .map(
            (p: PageSummary) => `<tr>
            <td class="truncate" title="${esc(p.url)}">${esc(p.url)}</td>
            <td class="truncate" title="${esc(p.title)}">${p.title ? esc(p.title) : '<span style="color:' + COLORS.error + '">—</span>'}</td>
            <td>${p.status_code}</td>
            <td>${p.h1_count}</td>
            <td>${p.schema_types.length ? 'Yes' : 'No'}</td>
            <td>${p.word_count}</td>
            <td>${p.issues.length ? `<span style="color:${COLORS.error};font-weight:600">${p.issues.length}</span>` : `<span style="color:${COLORS.success}">0</span>`}</td>
          </tr>`,
          )
          .join('')}</tbody>
      </table></div>`
  const inventorySection = accordion('Page Inventory', '', inventoryInner, SECTION_HELP.page_inventory)

  const recsInner = `<p class="muted small">Sorted by priority, then effort. ${result.recommendations.length} total.</p>
      <ul class="recs">${result.recommendations
        .map((r: Recommendation) => {
          const pColor = r.priority === 'critical' ? COLORS.error : COLORS.warning
          const eColor =
            r.effort === 'Low' ? COLORS.success : r.effort === 'Medium' ? COLORS.warning : COLORS.error
          return `<li class="rec">
            <div class="rec-head">
              <span class="chip" style="background:${pColor}1a;color:${chipText(pColor)}">${r.priority === 'critical' ? 'Critical' : 'Warning'}</span>
              <span class="muted small">${esc(r.category)}</span>
              <span class="chip right" style="background:${eColor}1a;color:${chipText(eColor)}">${esc(r.effort)} effort</span>
            </div>
            <div class="rec-title">${esc(r.title)}</div>
            <div class="muted">${esc(r.detail)}</div>
          </li>`
        })
        .join('')}</ul>`
  const recsSection = accordion('Recommendations', '', recsInner, SECTION_HELP.recommendations)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Site Audit — ${esc(result.site_name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700&family=Open+Sans:wght@400;600&display=swap" rel="stylesheet" />
<style>
  :root { --navy:${COLORS.navy}; --cyan:${COLORS.cyan}; }
  * { box-sizing: border-box; }
  body { margin:0; background:${COLORS.page}; color:${COLORS.textPrimary};
    font-family:'Open Sans',-apple-system,Segoe UI,sans-serif; line-height:1.5; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 32px 24px; }
  h1,h2,h3 { font-family:'Inter',sans-serif; color:${COLORS.navy}; margin:0; }
  h2 { font-size:18px; } h3 { font-size:16px; }
  .muted { color:${COLORS.textSecondary}; font-size:14px; }
  .small { font-size:12px; color:${COLORS.textMuted}; }
  .card { background:${COLORS.card}; border:1px solid ${COLORS.border}; border-radius:8px;
    box-shadow:0 5px 22px -6px rgba(35,31,32,.12); padding:24px; margin-bottom:20px; }
  header.report { background:${COLORS.navy}; color:#fff; display:flex; justify-content:space-between;
    align-items:center; gap:16px; flex-wrap:wrap; }
  header.report h1 { color:#fff; font-size:20px; margin-top:2px; }
  header.report a { color:${COLORS.cyan}; text-decoration:none; word-break:break-all; font-size:14px; }
  .brandmark { color:${COLORS.cyan}; font-family:'Inter',sans-serif; font-weight:700; font-size:12px; letter-spacing:.18em; }
  .badge { display:inline-block; background:rgba(9,129,149,.2); color:${COLORS.cyan};
    border-radius:100px; padding:4px 12px; font-family:Inter,sans-serif; font-weight:600; font-size:12px; }
  .chip { display:inline-flex; align-items:center; border-radius:100px; padding:2px 10px;
    font-family:Inter,sans-serif; font-weight:600; font-size:12px; }
  .chip.right { margin-left:auto; }
  .exec { display:flex; gap:32px; align-items:center; flex-wrap:wrap; }
  .exec-body { flex:1; min-width:240px; }
  .criticals { margin:16px 0 0; padding-left:18px; }
  .criticals li { margin-bottom:8px; font-size:14px; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:16px; }
  .grid-item { display:flex; justify-content:space-between; align-items:center; gap:8px;
    border:1px solid ${COLORS.border}; border-radius:8px; padding:12px 16px; background:${COLORS.page}; }
  .grid-item.strong { border-color:${COLORS.cyan}; }
  .grid-label { font-family:Inter,sans-serif; font-weight:600; font-size:14px; }
  .cat-head { display:flex; justify-content:space-between; align-items:center; }
  .findings { display:grid; grid-template-columns:repeat(2,1fr); gap:2px 24px; margin:16px 0 0; }
  .finding { display:flex; justify-content:space-between; gap:16px; padding:6px 0;
    border-bottom:1px solid ${COLORS.border}; }
  .finding dt { color:${COLORS.textSecondary}; font-size:14px; margin:0; }
  .finding dd { font-family:Inter,sans-serif; font-weight:600; font-size:14px; margin:0; text-align:right; }
  .table-wrap { overflow-x:auto; margin-top:12px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; background:rgba(9,129,149,.1); color:${COLORS.navy}; font-family:Inter,sans-serif;
    font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.04em; padding:10px 12px; }
  td { padding:10px 12px; border-bottom:1px solid ${COLORS.border}; }
  tr:nth-child(even) td { background:rgba(9,129,149,.04); }
  .truncate { max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .recs { list-style:none; margin:16px 0 0; padding:0; }
  .rec { border:1px solid ${COLORS.border}; border-radius:8px; padding:16px; margin-bottom:12px; background:${COLORS.page}; }
  .rec-head { display:flex; align-items:center; gap:8px; }
  .rec-title { font-family:Inter,sans-serif; font-weight:600; margin-top:8px; }
  .intel-sub { font-family:Inter,sans-serif; color:${COLORS.navy}; font-size:14px; margin:20px 0 8px; }
  .intel-list { margin:8px 0 0; padding-left:18px; }
  .intel-list li { margin-bottom:6px; font-size:14px; }
  .intel-person { padding:10px 0; border-bottom:1px solid ${COLORS.border}; font-size:14px; }
  .intel-person:last-child { border-bottom:0; }
  footer { text-align:center; color:${COLORS.textMuted}; font-size:12px; padding:24px 0; line-height:1.8; border-top:1px solid ${COLORS.border}; margin-top:8px; }
  .footer-brand { color:${COLORS.cyan}; font-family:'Inter',sans-serif; font-weight:700; letter-spacing:.18em; font-size:13px; }
  .section-heading { font-family:'Inter',sans-serif; color:${COLORS.navy}; font-size:18px; margin:0 0 16px; }
  .top-recs { margin-top:16px; border:1px solid rgba(9,129,149,.3); background:rgba(9,129,149,.05);
    border-radius:8px; padding:16px 20px; }
  .top-recs h3 { font-family:'Inter',sans-serif; color:${COLORS.navy}; font-size:12px; text-transform:uppercase;
    letter-spacing:.06em; margin:0 0 10px; }
  .top-recs ul { list-style:none; margin:0; padding:0; }
  .top-recs li { display:flex; align-items:flex-start; gap:10px; font-size:14px; margin-bottom:8px; }
  .top-recs li:last-child { margin-bottom:0; }
  .dot { width:8px; height:8px; border-radius:50%; margin-top:6px; flex-shrink:0; }
  .dash { border:1px solid ${COLORS.border}; border-radius:8px; padding:12px 16px; background:${COLORS.page}; }
  .dash-top { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
  .bar { height:4px; background:${COLORS.border}; border-radius:4px; margin-top:10px; overflow:hidden; }
  .bar-fill { height:4px; border-radius:4px; }
  .acc { padding:0; }
  .acc-head { display:flex; justify-content:space-between; align-items:center; gap:12px;
    padding:18px 24px; cursor:pointer; list-style:none; border-radius:inherit; }
  .acc-head::-webkit-details-marker { display:none; }
  .acc-head:hover { background:${COLORS.subtle}; }
  .acc-label { display:flex; align-items:center; gap:8px; min-width:0; }
  .acc-right { display:flex; align-items:center; gap:12px; }
  .chev { color:${COLORS.textMuted}; font-size:12px; transition:transform .2s; }
  details[open] .acc-head .chev { transform:rotate(180deg); }
  .acc-body { border-top:1px solid ${COLORS.border}; padding:20px 24px 24px; }
  .tip { position:relative; display:inline-flex; color:${COLORS.textMuted}; cursor:help; }
  .tip:hover, .tip:focus { color:${COLORS.cyan}; outline:none; }
  .tip-bubble { position:absolute; left:0; top:calc(100% + 8px); z-index:20; width:240px;
    background:${COLORS.navy}; color:#fff; font-family:'Open Sans',sans-serif; font-weight:400;
    font-size:12px; line-height:1.4; text-transform:none; letter-spacing:normal;
    padding:8px 12px; border-radius:6px; box-shadow:0 8px 24px -6px rgba(35,31,32,.45);
    opacity:0; visibility:hidden; transition:opacity .15s; pointer-events:none; }
  .tip:hover .tip-bubble, .tip:focus .tip-bubble, .tip:focus-within .tip-bubble { opacity:1; visibility:visible; }
  .cta { background:${COLORS.navy}; color:#fff; border-radius:8px; padding:32px 24px; text-align:center;
    box-shadow:0 5px 22px -6px rgba(35,31,32,.12); margin-bottom:20px; }
  .cta h2 { color:#fff; font-size:20px; }
  .cta p { color:rgba(255,255,255,.7); font-size:14px; max-width:560px; margin:8px auto 0; }
  .cta-btn { display:inline-block; margin-top:20px; background:${COLORS.cyan}; color:#fff;
    font-family:'Inter',sans-serif; font-weight:600; font-size:14px; text-decoration:none;
    padding:10px 24px; border-radius:100px; }
  @media (max-width:640px){ .grid,.findings{grid-template-columns:1fr;} }
</style>
</head>
<body>
<div class="wrap">
  <header class="report card">
    <div>
      <div class="brandmark">REVALTUS</div>
      <h1>${esc(result.site_name)}</h1>
      <a href="${esc(safeHref(result.url))}">${esc(result.url)}</a>
    </div>
    <div style="text-align:right">
      <span class="badge">Site Audit</span>
      <div style="color:rgba(255,255,255,.7);font-size:12px;margin-top:4px">${esc(runDate)}</div>
    </div>
  </header>
  ${summarySection}
  ${dashboardSection}
  ${sectionDetails}
  ${contentLibrarySection}
  ${digitalIntelSection}
  ${narrativeRecsSection}
  ${recsSection}
  ${ctaBoxHtml()}
  ${deltaSection}
  ${inventorySection}
  <footer>
    <div class="footer-brand">REVALTUS</div>
    <div>Prepared by Revaltus · ${esc(runDate)}</div>
    <div>Questions about this report? Just reply to the email it came in.</div>
  </footer>
</div>
</body>
</html>`
}
