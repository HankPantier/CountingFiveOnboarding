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
import type { AuditResult, CategoryScoreMap, Grade, PageSummary, Recommendation } from './types'

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
  error: '#6B2956',
}

const TOKEN_COLOR: Record<SemanticToken, string> = {
  success: COLORS.success,
  warning: COLORS.warning,
  error: COLORS.error,
  muted: COLORS.textMuted,
}

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
  return `<span class="chip" style="background:${c}1a;color:${c}">${esc(grade)} · ${score}</span>`
}

function scoreRingSvg(score: number, grade: Grade): string {
  const size = 160
  const stroke = 12
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circ
  const color = TOKEN_COLOR[gradeToken(grade)]
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
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

  const summarySection = `
    <section class="card exec">
      <div class="ring">${scoreRingSvg(result.overall_score, result.overall_grade)}</div>
      <div class="exec-body">
        <h2>Executive Summary</h2>
        <p class="muted">${result.pages_crawled} page${result.pages_crawled === 1 ? '' : 's'} crawled ·
          ${criticals.length} critical issue${criticals.length === 1 ? '' : 's'} ·
          ${result.recommendations.length} total recommendations</p>
        ${
          criticals.length
            ? `<ul class="criticals">${criticals
                .slice(0, 3)
                .map((r) => `<li><strong>${esc(r.title)}</strong> — ${esc(r.detail)}</li>`)
                .join('')}</ul>`
            : ''
        }
      </div>
    </section>`

  const dashboardSection = `
    <section class="card">
      <h2>Category Scores</h2>
      <div class="grid">
        ${CATEGORY_META.map(({ key, label, weight }) => {
          const cs = result.category_scores[key]
          return `<div class="grid-item">
            <div><div class="grid-label">${esc(label)}</div><div class="muted small">${weight}% weight</div></div>
            ${gradeChip(cs.grade, cs.score)}
          </div>`
        }).join('')}
      </div>
    </section>`

  const deltaSection = previous
    ? `<section class="card">
        <h2>Change Since Last Audit</h2>
        <div class="grid">
          <div class="grid-item strong"><div class="grid-label">Overall</div>${deltaCell(result.overall_score, previous.overall_score)}</div>
          ${CATEGORY_META.map(({ key, label }) => {
            return `<div class="grid-item"><div class="grid-label">${esc(label)}</div>${deltaCell(
              result.category_scores[key].score,
              previous.category_scores?.[key]?.score ?? null,
            )}</div>`
          }).join('')}
        </div>
      </section>`
    : ''

  const categorySections = CATEGORY_META.map(({ key, label }) => {
    const cs = result.category_scores[key]
    const rows = findingRows(result.findings[key])
    return `<section class="card">
      <div class="cat-head"><h3>${esc(label)}</h3>${gradeChip(cs.grade, cs.score)}</div>
      ${
        rows.length
          ? `<dl class="findings">${rows
              .map(
                (row) =>
                  `<div class="finding"><dt>${esc(row.label)}</dt><dd>${esc(row.value)}</dd></div>`,
              )
              .join('')}</dl>`
          : ''
      }
    </section>`
  }).join('')

  const inventorySection = `
    <section class="card">
      <h2>Page Inventory</h2>
      <p class="muted small">${result.page_analysis_summary.length} pages analyzed</p>
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
      </table></div>
    </section>`

  const recsSection = `
    <section class="card">
      <h2>Recommendations</h2>
      <p class="muted small">Sorted by priority, then effort. ${result.recommendations.length} total.</p>
      <ul class="recs">${result.recommendations
        .map((r: Recommendation) => {
          const pColor = r.priority === 'critical' ? COLORS.error : COLORS.warning
          const eColor =
            r.effort === 'Low' ? COLORS.success : r.effort === 'Medium' ? COLORS.warning : COLORS.error
          return `<li class="rec">
            <div class="rec-head">
              <span class="chip" style="background:${pColor}1a;color:${pColor}">${r.priority === 'critical' ? 'Critical' : 'Warning'}</span>
              <span class="muted small">${esc(r.category)}</span>
              <span class="chip right" style="background:${eColor}1a;color:${eColor}">${esc(r.effort)} effort</span>
            </div>
            <div class="rec-title">${esc(r.title)}</div>
            <div class="muted">${esc(r.detail)}</div>
          </li>`
        })
        .join('')}</ul>
    </section>`

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
  header.report h1 { color:#fff; font-size:20px; }
  header.report a { color:${COLORS.cyan}; text-decoration:none; word-break:break-all; font-size:14px; }
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
  footer { text-align:center; color:${COLORS.textMuted}; font-size:12px; padding:8px 0 24px; }
  @media (max-width:640px){ .grid,.findings{grid-template-columns:1fr;} }
</style>
</head>
<body>
<div class="wrap">
  <header class="report card">
    <div>
      <h1>${esc(result.site_name)}</h1>
      <a href="${esc(safeHref(result.url))}">${esc(result.url)}</a>
    </div>
    <div style="text-align:right">
      <span class="badge">Snapshot Report</span>
      <div style="color:rgba(255,255,255,.7);font-size:12px;margin-top:4px">${esc(runDate)}</div>
    </div>
  </header>
  ${summarySection}
  ${dashboardSection}
  ${deltaSection}
  ${categorySections}
  ${inventorySection}
  ${recsSection}
  <footer>Audit generated by Revaltus · ${esc(runDate)}</footer>
</div>
</body>
</html>`
}
