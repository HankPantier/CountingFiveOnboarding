// Pure. The design-model A/B report (scripts/compare-design-models.ts): the
// raw result types (written as report.json), the per-model summary, a plain
// text summary table for stdout, and a self-contained report.html (inline CSS,
// images by RELATIVE path inside the output dir). Every model-provided string
// (names, taglines, rationales, moves, critic text) and every error text is
// HTML-escaped; image paths and colours are allowlisted before use.
import type { DesignBundle } from '../bundle'
import { RUBRIC_KEYS, RUBRIC_LABELS, type CritiqueIssue, type RubricScores } from '../critique'
import type { DistinctnessRow } from '../distinctness'
import type { ApiUsage } from './api-tap'

export type AbViewport = 'desktop' | 'mobile'
export type AbShot = { page: string; viewport: AbViewport; file: string | null }
// One page's render checks: gate failures are diffed against the current
// site's metrics on the same page (metricGateFailures).
export type AbPageCheck = { page: string; measured: AbViewport[]; gateFailures: string[]; renderError: string | null }
export type AbCallStats = {
  latencyMs: number
  calls: number // Messages API requests observed (incl. retries / repair)
  usage: ApiUsage
  costUsd: number // exact + estimated, as the design caller accounts it
  estimatedUsd: number // part of costUsd estimated for attempts that never reported usage
  apiErrors: string[]
}
export type AbBundleView = Pick<DesignBundle, 'name' | 'tagline' | 'rationale' | 'moves' | 'palette' | 'typography' | 'treatments' | 'style'> & {
  tokens: Pick<DesignBundle['tokens'], 'roundness' | 'density' | 'visualFeel'>
}
export type AbCritique = { scores: RubricScores; mean: number; passed: boolean; summary: string; issues: CritiqueIssue[] }
export type AbConceptStatus = 'valid' | 'invalid' | 'failed' | 'skipped_cap'
export type AbCritiqueStatus = 'done' | 'disabled' | 'skipped_cap' | 'failed' | 'not_rendered' | 'not_valid'

export type AbConcept = {
  model: string
  position: number
  status: AbConceptStatus
  bundle: AbBundleView | null
  errors: string[]
  notes: string[]
  generation: AbCallStats | null
  shots: AbShot[]
  checks: AbPageCheck[]
  distinctness: DistinctnessRow[]
  critiqueStatus: AbCritiqueStatus
  critique: AbCritique | null
  critiqueStats: AbCallStats | null
  critiqueErrors: string[]
}

export type AbReport = {
  sessionId: string
  firmName: string
  generatedAt: string
  models: string[]
  criticModel: string | null
  // The judge is also one of the compared models (it grades its own work).
  criticIsContender: boolean
  pages: string[]
  primaryPage: string
  conceptsPerModel: number
  capUsd: number
  spentUsd: number
  capHit: boolean
  paletteFreedom: string
  capabilityLevel: number
  adminBrief: string | null
  referenceImages: number
  notes: string[]
  current: { shots: AbShot[]; checks: AbPageCheck[] }
  concepts: AbConcept[]
}

export type AbSummaryRow = {
  model: string
  attempted: number // concept slots that made a model call
  valid: number
  failed: number // invalid + failed
  skipped: number // skipped (cap)
  critiqued: number
  meanCriticScore: number | null
  passRate: number | null // passed / critiqued
  meanLatencyMs: number | null // per concept call (incl. its repair)
  conceptUsd: number
  criticUsd: number
  totalUsd: number
}

const round = (n: number, dp: number): number => Math.round(n * 10 ** dp) / 10 ** dp
const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length)

export function summarize(report: Pick<AbReport, 'models' | 'concepts'>): AbSummaryRow[] {
  return report.models.map((model) => {
    const rows = report.concepts.filter((c) => c.model === model)
    const attempted = rows.filter((c) => c.generation !== null)
    const critiqued = rows.filter((c): c is AbConcept & { critique: AbCritique } => c.critique !== null)
    const conceptUsd = rows.reduce((s, c) => s + (c.generation?.costUsd ?? 0), 0)
    const criticUsd = rows.reduce((s, c) => s + (c.critiqueStats?.costUsd ?? 0), 0)
    const meanScore = mean(critiqued.map((c) => c.critique.mean))
    const meanLatency = mean(attempted.map((c) => c.generation?.latencyMs ?? 0))
    return {
      model,
      attempted: attempted.length,
      valid: rows.filter((c) => c.status === 'valid').length,
      failed: rows.filter((c) => c.status === 'invalid' || c.status === 'failed').length,
      skipped: rows.filter((c) => c.status === 'skipped_cap').length,
      critiqued: critiqued.length,
      meanCriticScore: meanScore === null ? null : round(meanScore, 2),
      passRate: critiqued.length === 0 ? null : round(critiqued.filter((c) => c.critique.passed).length / critiqued.length, 3),
      meanLatencyMs: meanLatency === null ? null : Math.round(meanLatency),
      conceptUsd: round(conceptUsd, 4),
      criticUsd: round(criticUsd, 4),
      totalUsd: round(conceptUsd + criticUsd, 4),
    }
  })
}

const fmtUsd = (n: number): string => `$${n.toFixed(2)}`
const fmtSecs = (ms: number | null): string => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`)
const fmtPct = (r: number | null): string => (r === null ? '—' : `${Math.round(r * 100)}%`)
const fmtScore = (n: number | null): string => (n === null ? '—' : n.toFixed(2))

// Fixed-width text table for stdout.
export function summaryText(rows: AbSummaryRow[]): string {
  const header = ['model', 'valid', 'failed', 'skipped', 'critic mean', 'pass rate', 'mean latency', 'concepts $', 'critic $', 'total $']
  const body = rows.map((r) => [
    r.model,
    `${r.valid}/${r.attempted + r.skipped}`,
    String(r.failed),
    String(r.skipped),
    fmtScore(r.meanCriticScore),
    fmtPct(r.passRate),
    fmtSecs(r.meanLatencyMs),
    fmtUsd(r.conceptUsd),
    fmtUsd(r.criticUsd),
    fmtUsd(r.totalUsd),
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n')
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch])
}

// Images are referenced by a relative path inside the output dir; anything
// else (absolute, a scheme, traversal, odd characters) is dropped.
const REL_PATH_RE = /^[a-z0-9_-][a-z0-9._/-]*$/i
export function safeRelativePath(path: string | null): string | null {
  if (!path || !REL_PATH_RE.test(path) || path.split('/').some((seg) => seg === '..' || seg === '')) return null
  return path
}

const HEX_RE = /^#[0-9a-f]{6}$/i
export function safeHex(value: unknown): string | null {
  return typeof value === 'string' && HEX_RE.test(value) ? value.toLowerCase() : null
}

const STATUS_LABEL: Record<AbConceptStatus, string> = { valid: 'valid', invalid: 'invalid', failed: 'failed', skipped_cap: 'skipped (cap)' }
const CRITIQUE_LABEL: Record<AbCritiqueStatus, string> = {
  done: 'critiqued',
  disabled: 'critic off (--no-critic)',
  skipped_cap: 'skipped (cap)',
  failed: 'critique failed',
  not_rendered: 'not critiqued — no desktop render',
  not_valid: 'not critiqued — no valid concept',
}

const CSS = `
:root{--ink:#1a2433;--muted:#5b6778;--line:#dde3ea;--bg:#f6f8fa;--card:#fff;--ok:#1b7f4b;--bad:#b3261e;--warn:#8a5a00}
*{box-sizing:border-box}body{margin:0;padding:24px 16px;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg)}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px}h3{font-size:15px;margin:0 0 4px}h4{font-size:13px;margin:12px 0 4px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.meta{color:var(--muted);margin:0 0 8px}.judge{margin:0 0 8px}.notes li{color:var(--muted)}
table{border-collapse:collapse;background:var(--card);width:100%;max-width:1100px}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}th{background:#eef2f6;font-weight:600}
.cols{display:grid;grid-template-columns:repeat(var(--n),minmax(320px,1fr));gap:16px;overflow-x:auto}
.col{min-width:0}.col>h2{position:sticky;top:0;background:var(--bg);padding:6px 0;margin-top:0}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:16px}
.tag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:10px;border:1px solid var(--line);margin-right:4px}
.tag.ok{color:var(--ok);border-color:var(--ok)}.tag.bad{color:var(--bad);border-color:var(--bad)}.tag.warn{color:var(--warn);border-color:var(--warn)}
.tagline{color:var(--muted);margin:0 0 8px}.rationale{white-space:pre-wrap}
.swatches{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.sw{display:flex;align-items:center;gap:4px;font:12px ui-monospace,Menlo,monospace}.sw i{display:inline-block;width:22px;height:22px;border-radius:4px;border:1px solid var(--line)}
.shots{display:grid;grid-template-columns:3fr 1fr;gap:8px;margin:6px 0}.shots figure{margin:0}.shots img{width:100%;height:auto;border:1px solid var(--line);border-radius:4px;display:block}.shots figcaption{font-size:12px;color:var(--muted)}
.missing{font-size:12px;color:var(--muted);border:1px dashed var(--line);border-radius:4px;padding:12px;text-align:center}
ul{margin:4px 0;padding-left:18px}.err{color:var(--bad)}.small{font-size:12px;color:var(--muted)}
`

function tagFor(status: AbConceptStatus): string {
  const cls = status === 'valid' ? 'ok' : status === 'skipped_cap' ? 'warn' : 'bad'
  return `<span class="tag ${cls}">${escapeHtml(STATUS_LABEL[status])}</span>`
}

function list(items: string[], cls = ''): string {
  if (items.length === 0) return ''
  return `<ul${cls ? ` class="${cls}"` : ''}>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
}

function shotFigure(shot: AbShot | undefined, label: string): string {
  const src = safeRelativePath(shot?.file ?? null)
  if (!src) return `<figure><div class="missing">no ${escapeHtml(label)} render</div></figure>`
  return `<figure><img loading="lazy" src="${escapeHtml(src)}" alt="${escapeHtml(label)}"><figcaption>${escapeHtml(label)}</figcaption></figure>`
}

function shotsBlock(shots: AbShot[], checks: AbPageCheck[], pages: string[]): string {
  return pages
    .map((page) => {
      const d = shots.find((s) => s.page === page && s.viewport === 'desktop')
      const m = shots.find((s) => s.page === page && s.viewport === 'mobile')
      const check = checks.find((c) => c.page === page)
      const checkHtml = !check
        ? ''
        : check.renderError
          ? `<div class="small err">Render: ${escapeHtml(check.renderError)}</div>`
          : check.measured.length === 0
            ? '<div class="small">Render checks: not measured</div>'
            : check.gateFailures.length === 0
              ? `<div class="small">Render checks (${escapeHtml(check.measured.join(' + '))}): no new contrast / overflow / hidden-block failures</div>`
              : `<div class="small err">Render-check failures:</div>${list(check.gateFailures, 'err small')}`
      return `<h4>${escapeHtml(page)}</h4><div class="shots">${shotFigure(d, `${page} desktop`)}${shotFigure(m, `${page} mobile`)}</div>${checkHtml}`
    })
    .join('')
}

function statsBlock(label: string, s: AbCallStats | null): string {
  if (!s) return ''
  const u = s.usage
  const est = s.estimatedUsd > 0 ? ` (incl. ${fmtUsd(s.estimatedUsd)} estimated for aborted attempts)` : ''
  return `<div class="small">${escapeHtml(label)}: ${escapeHtml(fmtSecs(s.latencyMs))} · ${s.calls} API call${s.calls === 1 ? '' : 's'} · in ${u.inputTokens.toLocaleString('en-US')} / cache read ${u.cacheReadTokens.toLocaleString('en-US')} / cache write ${u.cacheWriteTokens.toLocaleString('en-US')} / out ${u.outputTokens.toLocaleString('en-US')} tokens · ${escapeHtml(fmtUsd(s.costUsd))}${escapeHtml(est)}</div>${s.apiErrors.length ? `<div class="small err">API errors:</div>${list(s.apiErrors, 'err small')}` : ''}`
}

function critiqueBlock(c: AbConcept): string {
  const head = `<h4>Critic</h4>`
  if (!c.critique) {
    return `${head}<div class="small">${escapeHtml(CRITIQUE_LABEL[c.critiqueStatus])}</div>${list(c.critiqueErrors, 'err small')}${statsBlock('Critic call', c.critiqueStats)}`
  }
  const k = c.critique
  const rows = RUBRIC_KEYS.map((key) => `<tr><td>${escapeHtml(RUBRIC_LABELS[key])}</td><td>${escapeHtml(k.scores[key])}</td></tr>`).join('')
  const issues = k.issues.map((i) => `<li><b>${escapeHtml(i.area)}</b>: ${escapeHtml(i.problem)} — <i>${escapeHtml(i.fix)}</i></li>`).join('')
  return `${head}<div><span class="tag ${k.passed ? 'ok' : 'bad'}">${k.passed ? 'pass' : 'fail'}</span> mean ${escapeHtml(k.mean.toFixed(2))}</div><table>${rows}</table><p>${escapeHtml(k.summary)}</p>${issues ? `<ul>${issues}</ul>` : ''}${statsBlock('Critic call', c.critiqueStats)}`
}

function conceptCard(c: AbConcept, pages: string[]): string {
  const b = c.bundle
  const title = b ? escapeHtml(b.name) : `Concept ${c.position + 1}`
  const parts: string[] = [`<h3>${c.position + 1}. ${title} ${tagFor(c.status)}</h3>`]
  if (b) {
    if (b.tagline) parts.push(`<p class="tagline">${escapeHtml(b.tagline)}</p>`)
    const sw = Object.entries(b.palette)
      .map(([role, hex]) => {
        const safe = safeHex(hex)
        return `<span class="sw"><i${safe ? ` style="background:${safe}"` : ''}></i>${escapeHtml(role)} ${escapeHtml(hex)}</span>`
      })
      .join('')
    parts.push(`<div class="swatches">${sw}</div>`)
    parts.push(
      `<div class="small">Fonts: ${escapeHtml(b.typography.headingFont)} / ${escapeHtml(b.typography.bodyFont)} / ${escapeHtml(b.typography.accentFont)} · ${escapeHtml(b.tokens.roundness)}, ${escapeHtml(b.tokens.density)}, ${escapeHtml(b.tokens.visualFeel)} · headline ${escapeHtml(b.treatments.headlineStyle)}, eyebrow ${escapeHtml(b.treatments.eyebrowStyle)}, dark sections ${b.treatments.darkSections ? 'on' : 'off'}${b.style ? ` · style ${escapeHtml(JSON.stringify(b.style))}` : ''}</div>`
    )
    if (b.rationale) parts.push(`<h4>Rationale</h4><div class="rationale">${escapeHtml(b.rationale)}</div>`)
    if (b.moves.length) parts.push(`<h4>Moves</h4>${list(b.moves)}`)
  }
  if (c.errors.length) parts.push(`<h4>Errors</h4>${list(c.errors, 'err')}`)
  if (c.notes.length) parts.push(list(c.notes, 'small'))
  parts.push(statsBlock('Concept call', c.generation))
  if (c.shots.length || c.checks.length) parts.push(shotsBlock(c.shots, c.checks, pages))
  if (c.distinctness.length) {
    parts.push(
      `<h4>Distinctness</h4><ul class="small">${c.distinctness.map((d) => `<li>vs ${escapeHtml(d.label)}: ΔE ${escapeHtml(d.deltaE.toFixed(1))}, ${d.leverDifferences} lever difference${d.leverDifferences === 1 ? '' : 's'}</li>`).join('')}</ul>`
    )
  }
  if (c.status === 'valid' || c.critiqueStats) parts.push(critiqueBlock(c))
  return `<div class="card">${parts.join('')}</div>`
}

export function buildReportHtml(report: AbReport): string {
  const rows = summarize(report)
  const summary = `<table><tr><th>Model</th><th>Valid concepts</th><th>Failed</th><th>Skipped (cap)</th><th>Mean critic score</th><th>Pass rate</th><th>Mean latency</th><th>Concepts $</th><th>Critic $</th><th>Total $</th></tr>${rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.model)}</td><td>${r.valid} / ${r.attempted + r.skipped}</td><td>${r.failed}</td><td>${r.skipped}</td><td>${escapeHtml(fmtScore(r.meanCriticScore))}</td><td>${escapeHtml(fmtPct(r.passRate))}</td><td>${escapeHtml(fmtSecs(r.meanLatencyMs))}</td><td>${escapeHtml(fmtUsd(r.conceptUsd))}</td><td>${escapeHtml(fmtUsd(r.criticUsd))}</td><td>${escapeHtml(fmtUsd(r.totalUsd))}</td></tr>`
    )
    .join('')}</table>`
  const meta = [
    `Session ${report.sessionId}`,
    `generated ${report.generatedAt}`,
    `${report.conceptsPerModel} concept${report.conceptsPerModel === 1 ? '' : 's'} per model`,
    `critic ${report.criticModel ?? 'off'}`,
    `prompt page ${report.primaryPage}`,
    `palette ${report.paletteFreedom}`,
    `capability L${report.capabilityLevel}`,
    `${report.referenceImages} reference image${report.referenceImages === 1 ? '' : 's'}`,
    `spent ${fmtUsd(report.spentUsd)} of ${fmtUsd(report.capUsd)} cap${report.capHit ? ' (cap reached)' : ''}`,
  ].join(' · ')
  const judge = report.criticModel
    ? `<p class="judge">Judge: <b>${escapeHtml(report.criticModel)}</b>${
        report.criticIsContender
          ? ' <span class="tag bad">warning: the judge is also a compared model — its scores may favour its own concepts</span>'
          : ' (not one of the compared models)'
      }</p>`
    : '<p class="judge">Judge: none (--no-critic)</p>'
  const attribution =
    '<p class="small">Spend is recorded in token_usage under the normal design_concept / design_critique stages, attributed to the session’s content job and its creator — on the Token Usage dashboard it appears as ordinary Design Studio spend.</p>'
  const brief = report.adminBrief ? `<p class="small">Admin brief: ${escapeHtml(report.adminBrief)}</p>` : ''
  const current = `<div class="card"><h3>Current site (the "before" + metrics baseline)</h3>${shotsBlock(report.current.shots, report.current.checks, report.pages)}</div>`
  const columns = report.models
    .map((model) => {
      const cards = report.concepts
        .filter((c) => c.model === model)
        .sort((a, b) => a.position - b.position)
        .map((c) => conceptCard(c, report.pages))
        .join('')
      return `<section class="col"><h2>${escapeHtml(model)}</h2>${cards}</section>`
    })
    .join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design model A/B — ${escapeHtml(report.firmName)}</title><style>${CSS}</style></head>
<body>
<h1>Design model A/B — ${escapeHtml(report.firmName)}</h1>
<p class="meta">${escapeHtml(meta)}</p>${judge}${attribution}${brief}
<h2>Summary</h2>${summary}
${report.notes.length ? `<h2>Notes</h2>${list(report.notes, 'notes')}` : ''}
<h2>Current site</h2>${current}
<h2>Concepts</h2>
<div class="cols" style="--n:${report.models.length}">${columns}</div>
</body></html>
`
}
