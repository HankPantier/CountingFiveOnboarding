// Standalone, shareable HTML report. Renders the stored AuditResult into a
// self-contained HTML document (inline CSS, Revaltus palette, no app/Tailwind
// dependency) that an admin can download and email to a client. The hex values
// here are intentional: a standalone file can't reference the app's design
// tokens, so the Revaltus palette is inlined in one <style> block.
import {
  CATEGORY_META,
  findingRows,
  gradeWithModifier,
  safeHref,
  score10,
  tokenForScore,
  type SemanticToken,
} from './report-format'
import {
  bucketMemberGrades,
  deriveDashboard,
  inferSection,
  passingCounts,
  siteHealthExtraRows,
  type DashboardBucket,
} from './report-buckets'
import { SECTION_HELP, SECTION_LABELS, signalLabel, subScoreRows } from './intelligence-format'
import type {
  AuditResult,
  CategoryScoreMap,
  CompetitiveIntelligence,
  ContentLibraryIntelligence,
  DigitalIntelligence,
  DomainIntelligence,
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
  success: '#076B7C', // deep teal — readable success text on light tints (AA), matches --color-success
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

/** Grade chip on the 0–10 scale: "C+ · 7.0". `score` is 0–100. */
function gradeChip(score: number | null): string {
  if (score === null) {
    return `<span class="chip" style="background:${COLORS.subtle};color:${COLORS.textMuted}">N/A</span>`
  }
  const c = TOKEN_COLOR[tokenForScore(score)]
  return `<span class="chip" style="background:${c}1a;color:${chipText(c)}">${esc(gradeWithModifier(score))} · ${score10(score)}</span>`
}

function scoreRingSvg(score: number): string {
  const size = 160
  const stroke = 12
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circ
  const color = TOKEN_COLOR[tokenForScore(score)]
  const grade = gradeWithModifier(score)
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Overall score ${score10(score)} out of 10, grade ${esc(grade)}">
    <title>Overall score ${score10(score)} out of 10, grade ${esc(grade)}</title>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${COLORS.border}" stroke-width="${stroke}" />
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${dash} ${circ - dash}" transform="rotate(-90 ${size / 2} ${size / 2})" />
    <text x="50%" y="44%" text-anchor="middle" font-size="42" font-weight="700" fill="${COLORS.textPrimary}" font-family="Inter,sans-serif">${score10(score)}</text>
    <text x="50%" y="58%" text-anchor="middle" font-size="12" font-weight="600" fill="${COLORS.textSecondary}" font-family="Inter,sans-serif">out of 10</text>
    <text x="50%" y="70%" text-anchor="middle" font-size="13" font-weight="700" fill="${color}" font-family="Inter,sans-serif">${esc(grade)}</text>
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

function scoreBar(score: number | null): string {
  const color = TOKEN_COLOR[tokenForScore(score)]
  const w = Math.max(0, Math.min(100, score ?? 0))
  return `<div class="bar"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div>`
}

/** "What This Means" labeled narrative block (matches the design target). */
function whatThisMeans(text: string | undefined): string {
  return text
    ? `<div class="wtm"><div class="wtm-label">What This Means</div><p>${esc(text)}</p></div>`
    : ''
}

/** Per-category grade chips, so a composite card's weighted headline is
 * explained by its parts. Empty for single-category cards. */
function memberGradesHtml(members: Array<{ label: string; score: number | null }>): string {
  if (!members.length) return ''
  return `<div class="subgrades">${members
    .map((m) => `<span class="subgrade"><span class="subgrade-label">${esc(m.label)}</span>${gradeChip(m.score)}</span>`)
    .join('')}</div>`
}

/** Merged Metric/Score findings for a composite card's member categories,
 * plus any extra rows (e.g. domain age, crawl errors for Site Health). */
function compositeBody(
  rows: Array<{ label: string; value: string }>,
  commentary: string | undefined,
  membersHtml = '',
): string {
  const findings = rows.length
    ? `<dl class="findings">${rows
        .map((r) => `<div class="finding"><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`)
        .join('')}</dl>`
    : ''
  return `${whatThisMeans(commentary)}${membersHtml}${findings}`
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
  return `<div class="table-wrap"><table class="recs-table">
    <thead><tr><th>Priority</th><th>Issue &amp; Impact</th><th>Section</th><th>Revaltus Service</th></tr></thead>
    <tbody>${narrative.recommendations
      .map((r) => {
        const c = NARRATIVE_PRIORITY_COLOR[r.priority] ?? COLORS.warning
        return `<tr>
          <td><span class="chip" style="background:${c}1a;color:${chipText(c)}">${esc(r.priority)}</span></td>
          <td><div class="rec-title">${esc(r.title)}</div>${r.business_impact ? `<div class="muted small">${esc(r.business_impact)}</div>` : ''}</td>
          <td class="muted small">${esc(inferSection(`${r.title} ${r.business_impact}`))}</td>
          <td class="muted small">${esc(r.counting_five_help)}</td>
        </tr>`
      })
      .join('')}</tbody>
  </table></div>`
}

/** One accordion for a dashboard card, dispatching on its kind. */
function bucketAccordion(
  result: AuditResult,
  bucket: DashboardBucket,
  sectionCommentary: Record<string, string>,
): string {
  const intel = result.intelligence
  if (bucket.kind === 'intel') {
    let body = ''
    if (bucket.key === 'target_market' && intel?.target_market) body = targetMarketBody(intel.target_market)
    else if (bucket.key === 'competitive' && intel?.competitive) body = competitiveBody(intel.competitive)
    else if (bucket.key === 'niche_services' && intel?.niche_services) body = nicheServicesBody(intel.niche_services)
    return accordion(
      bucket.label,
      gradeChip(bucket.score),
      `${whatThisMeans(sectionCommentary[bucket.key])}${body}`,
      SECTION_HELP[bucket.key],
    )
  }
  if (bucket.kind === 'tech_stack') {
    const flags = intel?.tech_stack?.risk_flags.length ?? 0
    const note = `<p class="muted small">Grade reflects ${flags} notable dependency risk${flags === 1 ? '' : 's'}.</p>`
    return accordion(
      bucket.label,
      gradeChip(bucket.score),
      `${whatThisMeans(sectionCommentary.tech_stack ?? intel?.tech_stack?.commentary)}${note}${techDomainBody(intel?.tech_stack, undefined)}`,
      SECTION_HELP.tech_stack,
    )
  }
  const rows = bucket.members.flatMap((k) => findingRows(result.findings[k]))
  if (bucket.key === 'site_health') rows.push(...siteHealthExtraRows(result))
  const wtm = bucket.members.map((k) => sectionCommentary[k]).filter(Boolean).join(' ') || undefined
  const membersHtml = memberGradesHtml(bucketMemberGrades(result, bucket))
  return accordion(bucket.label, gradeChip(bucket.score), compositeBody(rows, wtm, membersHtml), SECTION_HELP[bucket.key])
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

  // Eight client-friendly dashboard cards: strategic intel leads, then the
  // consolidated technical buckets. Drives the dashboard, the hero pills, and
  // the section accordions below — all from one grouping.
  const buckets = deriveDashboard(result)
  const { passing, needsWork } = passingCounts(buckets)
  const heroPills = `<div class="hero-pills"><span class="pill">${passing} Passing</span><span class="pill red">${needsWork} Need Work</span></div>`

  const summarySection = `
    <section class="card exec">
      <div class="ring">${scoreRingSvg(result.overall_score)}</div>
      <div class="exec-body">
        <h2>Executive Summary</h2>
        <p class="muted">${result.pages_crawled} page${result.pages_crawled === 1 ? '' : 's'} crawled ·
          ${criticals.length} critical issue${criticals.length === 1 ? '' : 's'} ·
          ${result.recommendations.length} total recommendations</p>
        ${heroPills}
        ${execProse ? `<p style="margin-top:12px">${esc(execProse)}</p>` : ''}
        ${topRecommendationsHtml(topRecs)}
      </div>
    </section>`

  const dashGrid = `<div class="grid">${buckets
    .map(
      (b) => `<div class="dash">
        <div class="dash-top"><div class="grid-label">${esc(b.label)}</div>${gradeChip(b.score)}</div>
        ${scoreBar(b.score)}
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

  // One accordion per dashboard card, in the same order — strategic intel,
  // then the consolidated technical buckets (with their member findings inside).
  const sectionDetails = buckets.map((b) => bucketAccordion(result, b, sectionCommentary)).join('')

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
  .rec-title { font-family:Inter,sans-serif; font-weight:600; }
  .recs-table td { vertical-align:top; }
  .recs-table .rec-title { margin-bottom:4px; }
  .hero-pills { display:flex; gap:8px; margin-top:14px; }
  .pill { display:inline-flex; align-items:center; border-radius:100px; padding:4px 14px;
    font-family:Inter,sans-serif; font-weight:600; font-size:12px;
    background:${COLORS.success}1a; color:${COLORS.success}; }
  .pill.red { background:${COLORS.error}1a; color:${COLORS.error}; }
  .wtm { margin-bottom:4px; border-left:3px solid ${COLORS.cyan}; background:${COLORS.subtle};
    border-radius:0 6px 6px 0; padding:12px 16px; }
  .wtm-label { font-family:Inter,sans-serif; font-weight:700; font-size:11px; text-transform:uppercase;
    letter-spacing:.06em; color:${COLORS.cyan}; margin-bottom:4px; }
  .wtm p { margin:0; font-size:14px; color:${COLORS.textSecondary}; }
  .subgrades { display:flex; flex-wrap:wrap; gap:8px 12px; margin-top:14px; }
  .subgrade { display:inline-flex; align-items:center; gap:6px; }
  .subgrade-label { font-family:Inter,sans-serif; font-weight:600; font-size:12px; color:${COLORS.textSecondary}; }
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
