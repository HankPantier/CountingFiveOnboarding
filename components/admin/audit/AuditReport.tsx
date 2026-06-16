import Image from 'next/image'
import type {
  AuditIntelligence,
  CategoryScoreMap,
  AuditResult,
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
} from '@/types/audit-result'
import { CATEGORY_META, findingRows, gradeToken, safeHref } from '@/lib/audit/report-format'
import { SECTION_LABELS, signalLabel, subScoreRows } from '@/lib/audit/intelligence-format'
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
  const intel = result.intelligence
  const sectionCommentary = intel?.narrative?.section_commentary ?? {}

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
            {intel?.narrative?.executive_summary && (
              <p className="mt-3 font-body text-sm text-text-primary">
                {intel.narrative.executive_summary}
              </p>
            )}
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

      {/* 3b. Intelligence — analytical sections */}
      {intel && <IntelligenceSections intel={intel} commentary={sectionCommentary} />}

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
              <Commentary text={sectionCommentary[key]} />
            </div>
          )
        })}
      </section>

      {/* 6a. Strategic recommendations (business-framed) */}
      {intel?.narrative && <NarrativeRecs narrative={intel.narrative} />}

      {/* 6. Technical recommendations */}
      <RecommendationsList recommendations={result.recommendations} />

      {/* 6b. Digital Intelligence Brief */}
      {intel?.digital_intelligence && (
        <DigitalIntelCard
          data={intel.digital_intelligence}
          commentary={sectionCommentary.digital_intelligence}
        />
      )}

      {/* 5. Page inventory */}
      <PageInventory pages={result.page_analysis_summary} />

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

// ── Intelligence layer ───────────────────────────────────────────────────────

const intelSubHeading = 'mt-5 font-heading text-sm font-semibold text-brand-navy'
const intelTableHead =
  'px-4 py-2 font-heading text-xs font-semibold uppercase tracking-wide text-brand-navy text-left'
const intelTd = 'px-4 py-2 align-top text-text-secondary'

function Commentary({ text }: { text?: string }) {
  if (!text) return null
  return <p className="mt-3 font-body text-sm text-text-secondary">{text}</p>
}

function SubScores({ sub }: { sub: Record<string, number> }) {
  const rows = subScoreRows(sub)
  if (!rows.length) return null
  return (
    <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 border-b border-border-default py-1.5 last:border-0">
          <dt className="font-body text-sm text-text-secondary">{row.label}</dt>
          <dd className="font-heading text-sm font-semibold text-text-primary text-right">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ScoredHead({ label, section }: { label: string; section: ScoredSection }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-base font-heading font-semibold text-brand-navy">{label}</h3>
      <GradeBadge grade={section.grade} score={section.score} />
    </div>
  )
}

function IntelTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm font-body">
        <thead>
          <tr className="border-b border-brand-cyan/20 bg-brand-cyan/10">
            {headers.map((h) => (
              <th key={h} className={intelTableHead}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-b border-border-default last:border-0 ${i % 2 === 1 ? 'bg-brand-cyan/5' : ''}`}>
              {r.map((c, j) => (
                <td key={j} className={intelTd}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function IntelligenceSections({
  intel,
  commentary,
}: {
  intel: AuditIntelligence
  commentary: Record<string, string>
}) {
  return (
    <section className="space-y-4">
      {intel.target_market && (
        <div className={`${cardClass} p-6`}>
          <ScoredHead label={SECTION_LABELS.target_market} section={intel.target_market} />
          <SubScores sub={intel.target_market.sub_scores} />
          <Commentary text={intel.target_market.commentary} />
          <Commentary text={commentary.target_market} />
        </div>
      )}
      {intel.niche_services && (
        <NicheServicesCard data={intel.niche_services} commentary={commentary.niche_services} />
      )}
      {intel.competitive && (
        <CompetitiveCard data={intel.competitive} commentary={commentary.competitive} />
      )}
      {(intel.tech_stack || intel.domain) && (
        <TechDomainCard tech={intel.tech_stack} domain={intel.domain} commentary={commentary.tech_stack} />
      )}
      {intel.content_library && (
        <ContentLibraryCard data={intel.content_library} commentary={commentary.content_library} />
      )}
    </section>
  )
}

function NicheServicesCard({ data, commentary }: { data: NicheServicesIntelligence; commentary?: string }) {
  return (
    <div className={`${cardClass} p-6`}>
      <ScoredHead label={SECTION_LABELS.niche_services} section={data} />
      <SubScores sub={data.sub_scores} />
      <Commentary text={data.commentary} />
      <Commentary text={commentary} />
      {data.detected_niches.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Detected Niches</h4>
          <ul className="mt-2 space-y-1.5 font-body text-sm text-text-secondary">
            {data.detected_niches.map((d, i) => (
              <li key={i}>
                <span className="font-semibold text-text-primary">{d.name}</span>{' '}
                <span className="text-text-muted">({signalLabel(d.signal)})</span> — {d.note}
              </li>
            ))}
          </ul>
        </>
      )}
      {data.invisible_niches.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Invisible but High-Opportunity Niches</h4>
          <ul className="mt-2 space-y-1.5 font-body text-sm text-text-secondary">
            {data.invisible_niches.map((d, i) => (
              <li key={i}>
                <span className="font-semibold text-text-primary">{d.name}</span> — {d.opportunity}
              </li>
            ))}
          </ul>
        </>
      )}
      {data.services_analysis.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Services Communication Analysis</h4>
          <IntelTable
            headers={['Service', 'Clarity', 'Framing', 'Audience', 'Rewrite Direction']}
            rows={data.services_analysis.map((s) => [s.service, s.clarity, s.framing, s.audience, s.rewrite_direction])}
          />
        </>
      )}
      {data.top_improvements.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Top Highest-Impact Improvements</h4>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 font-body text-sm text-text-secondary">
            {data.top_improvements.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

function CompetitiveCard({ data, commentary }: { data: CompetitiveIntelligence; commentary?: string }) {
  return (
    <div className={`${cardClass} p-6`}>
      <ScoredHead label={SECTION_LABELS.competitive} section={data} />
      <SubScores sub={data.sub_scores} />
      {data.keyword_rankings.length > 0 && (
        <IntelTable
          headers={['Keyword', 'Rank', 'Note']}
          rows={data.keyword_rankings.map((k) => [k.keyword, k.rank === null ? '—' : `#${k.rank}`, k.note])}
        />
      )}
      <Commentary text={data.commentary} />
      {data.local_seo && (
        <p className="mt-3 font-body text-sm text-text-secondary">
          <span className="font-semibold text-text-primary">Local SEO:</span> {data.local_seo}
        </p>
      )}
      {data.ai_search_presence && (
        <p className="mt-2 font-body text-sm text-text-secondary">
          <span className="font-semibold text-text-primary">AI Search:</span> {data.ai_search_presence}
        </p>
      )}
      <Commentary text={commentary} />
    </div>
  )
}

function TechDomainCard({
  tech,
  domain,
  commentary,
}: {
  tech?: TechStackIntelligence
  domain?: DomainIntelligence
  commentary?: string
}) {
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
  return (
    <div className={`${cardClass} p-6`}>
      <h3 className="text-base font-heading font-semibold text-brand-navy">
        {SECTION_LABELS.tech_stack} &amp; Domain
      </h3>
      {rows.length > 0 && (
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map(([k, v], i) => (
            <div key={i} className="flex items-baseline justify-between gap-4 border-b border-border-default py-1.5 last:border-0">
              <dt className="font-body text-sm text-text-secondary">{k}</dt>
              <dd className="font-heading text-sm font-semibold text-text-primary text-right">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {tech && tech.risk_flags.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Flags</h4>
          <ul className="mt-2 space-y-1.5 font-body text-sm text-error">
            {tech.risk_flags.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}
      <Commentary text={tech?.commentary} />
      <Commentary text={commentary} />
    </div>
  )
}

function ContentLibraryCard({ data, commentary }: { data: ContentLibraryIntelligence; commentary?: string }) {
  return (
    <div className={`${cardClass} p-6`}>
      <h3 className="text-base font-heading font-semibold text-brand-navy">{SECTION_LABELS.content_library}</h3>
      <p className="mt-1 font-body text-xs text-text-muted">
        {data.total_pieces} published piece{data.total_pieces === 1 ? '' : 's'}
      </p>
      {data.formats.length > 0 && (
        <IntelTable
          headers={['Format', 'Count', 'Cadence']}
          rows={data.formats.map((f) => [f.type, String(f.count), f.cadence])}
        />
      )}
      <Commentary text={data.syndication_assessment} />
      {data.recommendations.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Recommendations</h4>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 font-body text-sm text-text-secondary">
            {data.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}
      <Commentary text={commentary} />
    </div>
  )
}

const NARRATIVE_PRIORITY_CLASS: Record<string, string> = {
  High: 'bg-error/10 text-error',
  Medium: 'bg-warning/15 text-warning-strong',
  Low: 'bg-success/10 text-success',
}

function NarrativeRecs({ narrative }: { narrative: NarrativeIntelligence }) {
  if (!narrative.recommendations.length) return null
  return (
    <section className={`${cardClass} p-6`}>
      <h2 className={sectionTitle}>Recommendations &amp; Next Steps</h2>
      <ul className="mt-4 space-y-3">
        {narrative.recommendations.map((r, i) => (
          <li key={i} className="rounded-lg border border-border-default border-l-4 border-l-brand-cyan bg-surface-page p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-heading font-semibold ${
                  NARRATIVE_PRIORITY_CLASS[r.priority] ?? 'bg-warning/15 text-warning-strong'
                }`}
              >
                {r.priority} priority
              </span>
            </div>
            <p className="mt-2 font-heading text-sm font-semibold text-text-primary">{r.title}</p>
            {r.business_impact && (
              <p className="mt-1 font-body text-sm text-text-secondary">
                <span className="font-semibold">Business impact:</span> {r.business_impact}
              </p>
            )}
            {r.counting_five_help && (
              <p className="mt-1 font-body text-sm text-text-secondary">
                <span className="font-semibold">How we help:</span> {r.counting_five_help}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function DigitalIntelCard({ data, commentary }: { data: DigitalIntelligence; commentary?: string }) {
  const rep = data.reputation
  const gap = data.niche_gap
  return (
    <section className={`${cardClass} p-6`}>
      <h2 className={sectionTitle}>{SECTION_LABELS.digital_intelligence}</h2>
      <p className="mt-1 font-body text-xs text-text-muted">External research — not scored</p>

      {data.personnel.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Key Personnel</h4>
          <div className="mt-2 divide-y divide-border-default">
            {data.personnel.map((p, i) => (
              <div key={i} className="py-2.5 font-body text-sm">
                <div>
                  <span className="font-semibold text-text-primary">{p.name}</span> · {p.role}{' '}
                  <span className="text-text-muted">({p.footprint} footprint)</span>
                </div>
                {p.associations.length > 0 && (
                  <div className="text-xs text-text-muted">Associations: {p.associations.join(', ')}</div>
                )}
                {p.notes && <div className="text-text-secondary">{p.notes}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {(rep.sentiment || rep.ratings.length > 0 || rep.praise_themes.length > 0 || rep.concern_themes.length > 0) && (
        <>
          <h4 className={intelSubHeading}>Reputation Signals</h4>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {rep.sentiment && <Field label="Sentiment" value={rep.sentiment} />}
            {rep.ratings.length > 0 && <Field label="Ratings" value={rep.ratings.join(', ')} />}
            {rep.praise_themes.length > 0 && <Field label="Praise" value={rep.praise_themes.join(', ')} />}
            {rep.concern_themes.length > 0 && <Field label="Concerns" value={rep.concern_themes.join(', ')} />}
          </dl>
        </>
      )}

      {data.affiliations.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Affiliations</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 font-body text-sm text-text-secondary">
            {data.affiliations.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </>
      )}

      {data.content_footprint.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Content Footprint</h4>
          <IntelTable
            headers={['Type', 'Title', 'Source']}
            rows={data.content_footprint.map((f) => [f.type, f.title, f.source])}
          />
        </>
      )}

      {data.social_presence.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Social Media Presence</h4>
          <ul className="mt-2 space-y-1.5 font-body text-sm text-text-secondary">
            {data.social_presence.map((s, i) => (
              <li key={i}>
                <span className="font-semibold text-text-primary">{s.platform}</span> — {s.status}
                {s.detail ? ` · ${s.detail}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}

      {(gap.external.length > 0 || gap.on_site.length > 0 || gap.unleveraged.length > 0) && (
        <>
          <h4 className={intelSubHeading}>External vs. Website Niche Gap</h4>
          {gap.on_site.length > 0 && (
            <p className="mt-2 font-body text-sm text-text-secondary">
              <span className="font-semibold text-text-primary">On website:</span> {gap.on_site.join(', ')}
            </p>
          )}
          {gap.external.length > 0 && (
            <p className="mt-1 font-body text-sm text-text-secondary">
              <span className="font-semibold text-text-primary">Found externally:</span> {gap.external.join(', ')}
            </p>
          )}
          {gap.unleveraged.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 font-body text-sm text-text-secondary">
              {gap.unleveraged.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          )}
        </>
      )}

      <Commentary text={commentary} />
    </section>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-default py-1.5 last:border-0">
      <dt className="font-body text-sm text-text-secondary">{label}</dt>
      <dd className="font-heading text-sm font-semibold text-text-primary text-right">{value}</dd>
    </div>
  )
}

// Re-export to keep status badge import paths consistent for the report shell.
export { AuditStatusBadge }
