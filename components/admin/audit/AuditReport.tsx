import Image from 'next/image'
import type { CategoryScoreMap, AuditResult, PageSummary, Recommendation } from '@/types/audit-result'
import { CATEGORY_META, findingRows, gradeToken, safeHref } from '@/lib/audit/report-format'
import { AuditStatusBadge, GradeBadge } from './AuditBadges'
import { ScoreRing } from './ScoreRing'

const cardClass = 'bg-surface-card border border-border-default rounded-lg shadow-subtle'
const sectionTitle = 'text-lg font-heading font-semibold text-brand-navy'

const ACCENT_BY_TOKEN: Record<string, string> = {
  success: 'border-l-success',
  warning: 'border-l-warning',
  error: 'border-l-error',
  muted: 'border-l-border-strong',
}

function Delta({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null || current === previous) {
    return <span className="text-text-muted text-xs" title="No change">—</span>
  }
  const diff = current - previous
  const up = diff > 0
  return (
    <span
      className={`text-xs font-heading font-semibold ${up ? 'text-success' : 'text-error'}`}
      title={`${up ? '+' : ''}${diff} since last audit`}
    >
      {up ? '▲' : '▼'} {Math.abs(diff)}
    </span>
  )
}

export interface AuditReportProps {
  result: AuditResult
  createdAt: string
  previous?: { overall_score: number | null; category_scores: CategoryScoreMap | null } | null
}

export function AuditReport({ result, createdAt, previous }: AuditReportProps) {
  const runDate = new Date(createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const criticals = result.recommendations.filter((r) => r.priority === 'critical')
  const topCritical = criticals.slice(0, 3)

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      {/* 1. Header */}
      <header className={`${cardClass} flex items-center justify-between gap-4 bg-brand-navy p-6`}>
        <div className="flex items-center gap-4">
          <Image src="/logo.png" alt="Revaltus" height={36} width={200} style={{ height: 36, width: 'auto' }} />
          <div>
            <h1 className="text-xl font-heading font-bold text-text-inverse">
              {result.site_name}
            </h1>
            <a
              href={safeHref(result.url)}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-body text-brand-cyan hover:underline break-all"
            >
              {result.url}
            </a>
          </div>
        </div>
        <div className="text-right">
          <span className="inline-flex items-center rounded-full bg-brand-cyan/20 px-3 py-1 text-xs font-heading font-semibold text-brand-cyan">
            Snapshot Report
          </span>
          <p className="mt-1 text-xs font-body text-text-inverse/70">{runDate}</p>
        </div>
      </header>

      {/* 2. Executive summary — the report's hero */}
      <section className="rounded-lg border border-border-default border-t-4 border-t-brand-cyan bg-surface-card p-8 shadow-elevated">
        <div className="flex flex-col items-center gap-6 md:flex-row md:items-center md:gap-10">
          <ScoreRing score={result.overall_score} grade={result.overall_grade} size={200} />
          <div className="flex-1">
            <h2 className={sectionTitle}>Executive Summary</h2>
            <p className="mt-1 font-body text-sm text-text-secondary">
              {result.pages_crawled} page{result.pages_crawled === 1 ? '' : 's'} crawled ·{' '}
              {criticals.length} critical issue{criticals.length === 1 ? '' : 's'} ·{' '}
              {result.recommendations.length} total recommendations
            </p>
            {topCritical.length > 0 && (
              <ul className="mt-4 space-y-2">
                {topCritical.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm font-body text-text-primary">
                    <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-error" />
                    <span>
                      <span className="font-semibold">{r.title}</span> — {r.detail}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* 3. Score dashboard */}
      <section className={`${cardClass} p-6`}>
        <h2 className={sectionTitle}>Category Scores</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CATEGORY_META.map(({ key, label, weight }) => {
            const cs = result.category_scores[key]
            return (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg border border-border-default bg-surface-page px-4 py-3"
              >
                <div>
                  <p className="font-heading text-sm font-semibold text-text-primary">{label}</p>
                  <p className="font-body text-xs text-text-muted">{weight}% weight</p>
                </div>
                <GradeBadge grade={cs.grade} score={cs.score} />
              </div>
            )
          })}
        </div>
      </section>

      {/* 7. Score-delta panel (rendered early when a prior run exists) */}
      {previous && (
        <section className={`${cardClass} p-6`}>
          <h2 className={sectionTitle}>Change Since Last Audit</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-lg border border-border-strong bg-surface-page px-4 py-3">
              <p className="font-heading text-sm font-semibold text-text-primary">Overall</p>
              <Delta current={result.overall_score} previous={previous.overall_score} />
            </div>
            {CATEGORY_META.map(({ key, label }) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg border border-border-default bg-surface-page px-4 py-3"
              >
                <p className="font-heading text-sm font-semibold text-text-primary">{label}</p>
                <Delta
                  current={result.category_scores[key].score}
                  previous={previous.category_scores?.[key]?.score ?? null}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. Per-category findings */}
      <section className="space-y-4">
        {CATEGORY_META.map(({ key, label }) => {
          const cs = result.category_scores[key]
          const rows = findingRows(result.findings[key])
          return (
            <div key={key} className={`${cardClass} border-l-4 ${ACCENT_BY_TOKEN[gradeToken(cs.grade)]} p-6`}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-heading font-semibold text-brand-navy">{label}</h3>
                <GradeBadge grade={cs.grade} score={cs.score} />
              </div>
              {rows.length > 0 && (
                <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  {rows.map((row, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-4 border-b border-border-default py-1.5 last:border-0">
                      <dt className="font-body text-sm text-text-secondary">{row.label}</dt>
                      <dd className="font-heading text-sm font-semibold text-text-primary text-right">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )
        })}
      </section>

      {/* 5. Page inventory */}
      <PageInventory pages={result.page_analysis_summary} />

      {/* 6. Recommendations */}
      <RecommendationsList recommendations={result.recommendations} />

      {/* 8. Footer */}
      <footer className="pt-2 text-center">
        <p className="font-body text-xs text-text-muted">
          Audit generated by Revaltus · {runDate}
        </p>
      </footer>
    </div>
  )
}

function PageInventory({ pages }: { pages: PageSummary[] }) {
  return (
    <section className={`${cardClass} overflow-hidden`}>
      <div className="border-b border-border-default p-6 pb-4">
        <h2 className={sectionTitle}>Page Inventory</h2>
        <p className="mt-1 font-body text-xs text-text-muted">{pages.length} pages analyzed</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="border-b border-brand-cyan/20 bg-brand-cyan/10 text-left">
              {['URL', 'Title', 'Status', 'H1', 'Schema', 'Words', 'Issues'].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 font-heading text-xs font-semibold uppercase tracking-wide text-brand-navy"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pages.map((p, i) => (
              <tr
                key={p.url}
                className={`border-b border-border-default last:border-0 ${i % 2 === 1 ? 'bg-brand-cyan/5' : ''}`}
              >
                <td className="max-w-[220px] truncate px-4 py-3 text-text-secondary" title={p.url}>
                  {p.url}
                </td>
                <td className="max-w-[220px] truncate px-4 py-3 text-text-primary" title={p.title}>
                  {p.title || <span className="text-error">—</span>}
                </td>
                <td className="px-4 py-3">{p.status_code}</td>
                <td className="px-4 py-3">{p.h1_count}</td>
                <td className="px-4 py-3">{p.schema_types.length ? 'Yes' : 'No'}</td>
                <td className="px-4 py-3">{p.word_count}</td>
                <td className="px-4 py-3">
                  {p.issues.length ? (
                    <span className="text-error font-semibold">{p.issues.length}</span>
                  ) : (
                    <span className="text-success">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const EFFORT_CLASS: Record<string, string> = {
  Low: 'bg-success/10 text-success',
  Medium: 'bg-warning/15 text-warning-strong',
  High: 'bg-error/10 text-error',
}

function RecommendationsList({ recommendations }: { recommendations: Recommendation[] }) {
  return (
    <section className={`${cardClass} p-6`}>
      <h2 className={sectionTitle}>Recommendations</h2>
      <p className="mt-1 font-body text-xs text-text-muted">
        Sorted by priority, then effort. {recommendations.length} total.
      </p>
      <ul className="mt-4 space-y-3">
        {recommendations.map((r, i) => (
          <li
            key={i}
            className={`rounded-lg border border-border-default border-l-4 bg-surface-page p-4 ${
              r.priority === 'critical' ? 'border-l-error' : 'border-l-warning'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-heading font-semibold ${
                  r.priority === 'critical'
                    ? 'bg-error/10 text-error'
                    : 'bg-warning/15 text-warning-strong'
                }`}
              >
                {r.priority === 'critical' ? 'Critical' : 'Warning'}
              </span>
              <span className="font-body text-xs text-text-muted">{r.category}</span>
              <span
                className={`ml-auto inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-heading font-semibold ${EFFORT_CLASS[r.effort]}`}
              >
                {r.effort} effort
              </span>
            </div>
            <p className="mt-2 font-heading text-sm font-semibold text-text-primary">{r.title}</p>
            <p className="mt-1 font-body text-sm text-text-secondary">{r.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Re-export to keep status badge import paths consistent for the report shell.
export { AuditStatusBadge }
