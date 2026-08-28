import type { ReactNode } from 'react'
import Image from 'next/image'
import { ArrowUpRight, ChevronDown, Info, Lightbulb } from 'lucide-react'
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
  SocialPresenceReport,
  SocialProfileAssessment,
  TeamSocialReport,
  TechStackIntelligence,
} from '@/types/audit-result'
import {
  CATEGORY_META,
  findingRows,
  safeHref,
  tokenForScore,
  type SemanticToken,
} from '@/lib/audit/report-format'
import {
  bucketMemberGrades,
  deriveDashboard,
  inferSection,
  passingCounts,
  siteHealthExtraRows,
  type DashboardBucket,
} from '@/lib/audit/report-buckets'
import {
  formatSocialMetrics,
  SECTION_HELP,
  SECTION_LABELS,
  signalLabel,
  SOCIAL_PLATFORM_LABELS,
  subScoreRows,
} from '@/lib/audit/intelligence-format'
import { AuditStatusBadge, GradeBadge } from './AuditBadges'
import { MiniGauge, ScoreRing } from './ScoreRing'
import { IconChip } from './section-icons'
import { barPercent, MetricBar } from './MetricBars'
import CategoryRadar, { type RadarDatum } from './CategoryRadar'
import KeywordRankChart from './KeywordRankChart'
import ContentFormatsChart from './ContentFormatsChart'
import RecommendationsBreakdown from './RecommendationsBreakdown'
import PageInventoryCharts from './PageInventoryCharts'
import ScoreTrendChart, { type TrendCategory, type TrendPoint } from './ScoreTrendChart'
import { keywordRankBars, pageInventoryStats, recommendationStats } from '@/lib/audit/report-aggregates'
import type { ScoreHistoryPoint } from '@/lib/audit/report-data'

const cardClass = 'bg-surface-card border border-border-default rounded-xl shadow-subtle'
const sectionTitle = 'text-lg font-heading font-semibold text-brand-navy'

// Short axis labels for the category radar — the full CATEGORY_META labels are
// too long to sit around a 9-point polygon without clipping.
const RADAR_SHORT: Record<string, string> = {
  performance: 'Performance',
  technical: 'Technical',
  onpage_seo: 'On-Page SEO',
  ux: 'UX & A11y',
  content: 'Content',
  indexability: 'Indexability',
  schema: 'Schema',
  ai_llm: 'AI / LLM',
  analytics: 'Analytics',
}

const TOKEN_BG: Record<SemanticToken, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  muted: 'bg-text-muted',
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
  scoreHistory?: ScoreHistoryPoint[]
}

export function AuditReport({ result, createdAt, previous, scoreHistory }: AuditReportProps) {
  const runDate = new Date(createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const criticals = result.recommendations.filter((r) => r.priority === 'critical')
  const intel = result.intelligence
  const sectionCommentary = intel?.narrative?.section_commentary ?? {}

  // Top Recommendations callout — prefer the business-framed narrative recs,
  // fall back to the first three critical technical findings.
  const narrativeRecs = asArray<NarrativeIntelligence['recommendations'][number]>(
    intel?.narrative?.recommendations
  )
  const topRecs: Array<{ title: string; detail: string; token: SemanticToken }> = narrativeRecs.length
    ? narrativeRecs.slice(0, 3).map((r) => ({
        title: r.title,
        detail: r.business_impact,
        token: r.priority === 'High' ? 'error' : r.priority === 'Medium' ? 'warning' : 'success',
      }))
    : criticals.slice(0, 3).map((r) => ({ title: r.title, detail: r.detail, token: 'error' as const }))

  // Eight client-friendly dashboard cards: strategic intel leads, then the
  // consolidated technical buckets. One grouping drives the dashboard, the hero
  // pills, and the section accordions below.
  const buckets = deriveDashboard(result)
  const { passing, needsWork } = passingCounts(buckets)

  const radarData: RadarDatum[] = CATEGORY_META.map(({ key, label }) => ({
    label: RADAR_SHORT[key] ?? label,
    score: result.category_scores[key]?.score ?? 0,
  }))

  const trend: TrendPoint[] = (scoreHistory ?? [])
    .filter((p) => p.overall_score !== null)
    .map((p) => ({
      date: new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      score: p.overall_score as number,
    }))
  const trendCategories: TrendCategory[] | null = previous
    ? CATEGORY_META.map(({ key, label }) => ({
        label: RADAR_SHORT[key] ?? label,
        current: result.category_scores[key]?.score ?? 0,
        previous: previous.category_scores?.[key]?.score ?? null,
      }))
    : null

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      {/* 1. Header */}
      <header className={`${cardClass} flex items-center justify-between gap-4 p-6`}>
        <div className="flex items-center gap-4">
          <Image src="/logo.png" alt="Revaltus" height={36} width={200} style={{ height: 36, width: 'auto' }} />
          <div>
            <h1 className="text-xl font-heading font-bold text-brand-navy">
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
          <span className="inline-flex items-center rounded-badge bg-brand-cyan/10 px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] text-brand-cyan-dark">
            Snapshot Report
          </span>
          <p className="mt-1 text-xs font-body text-text-muted">{runDate}</p>
        </div>
      </header>

      {/* 2. Hero — brand "box card": navy band, overlapping icon badge, score
          ring, executive summary, and the Top Recommendations checklist. */}
      <section className="rounded-2xl bg-gradient-to-br from-brand-navy to-brand-navy-deeper px-2 pb-2 pt-10 shadow-elevated">
        <div className="relative rounded-[14px] border-t-4 border-t-brand-cyan bg-surface-card p-8">
          <span className="absolute -top-5 left-8">
            <IconChip iconKey="audit" size="lg" />
          </span>
          <div className="flex flex-col items-center gap-6 md:flex-row md:items-start md:gap-10">
            <ScoreRing score={result.overall_score} size={200} />
            <div className="flex-1">
              <h2 className={sectionTitle}>Executive Summary</h2>
              <p className="mt-1 font-body text-sm text-text-secondary">
                {result.pages_crawled} page{result.pages_crawled === 1 ? '' : 's'} crawled ·{' '}
                {criticals.length} critical issue{criticals.length === 1 ? '' : 's'} ·{' '}
                {result.recommendations.length} total recommendations
              </p>
              <div className="mt-3.5 flex gap-2">
                <span className="inline-flex items-center rounded-badge bg-success/10 px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] text-success">
                  {passing} Passing
                </span>
                <span className="inline-flex items-center rounded-badge bg-error/10 px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] text-error">
                  {needsWork} Need Work
                </span>
              </div>
              {intel?.narrative?.executive_summary && (
                <p className="mt-3 font-body text-sm text-text-primary">
                  {intel.narrative.executive_summary}
                </p>
              )}
            </div>
          </div>
          <TopRecommendations items={topRecs} />
        </div>
      </section>

      {/* 3. Collapsible sections — every section is an accordion, all closed */}
      <section className="space-y-3">
        <AuditAccordion label="Score Dashboard" tip={SECTION_HELP.dashboard} iconKey="dashboard">
          <div className="rounded-xl border border-border-default bg-surface-page p-4">
            <p className="mb-1 font-heading text-xs font-semibold uppercase tracking-wide text-brand-navy">
              Category Profile
            </p>
            <CategoryRadar data={radarData} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {buckets.map((b) => (
              <DashboardCard key={b.key} card={b} />
            ))}
          </div>
        </AuditAccordion>

        {buckets.map((b) => (
          <BucketSection key={b.key} result={result} bucket={b} sectionCommentary={sectionCommentary} />
        ))}

        {intel?.content_library && (
          <AuditAccordion
            label={SECTION_LABELS.content_library}
            tip={SECTION_HELP.content_library}
            iconKey="content_library"
          >
            <ContentLibraryBody data={intel.content_library} commentary={sectionCommentary.content_library} />
          </AuditAccordion>
        )}

        {intel?.social_presence && (
          <AuditAccordion
            label={SECTION_LABELS.social_presence}
            tip={SECTION_HELP.social_presence}
            iconKey="social_presence"
          >
            <SocialPresenceBody
              data={intel.social_presence}
              commentary={sectionCommentary.social_presence}
            />
          </AuditAccordion>
        )}

        {intel?.team_social && (
          <AuditAccordion
            label={SECTION_LABELS.team_social}
            tip={SECTION_HELP.team_social}
            iconKey="team_social"
          >
            <TeamSocialBody
              data={intel.team_social}
              commentary={sectionCommentary.team_social}
            />
          </AuditAccordion>
        )}

        {intel?.digital_intelligence && (
          <AuditAccordion
            label={SECTION_LABELS.digital_intelligence}
            tip={SECTION_HELP.digital_intelligence}
            iconKey="digital_intelligence"
          >
            <DigitalIntelBody
              data={intel.digital_intelligence}
              commentary={sectionCommentary.digital_intelligence}
            />
          </AuditAccordion>
        )}

        {intel?.narrative && narrativeRecs.length ? (
          <AuditAccordion
            label="Recommendations &amp; Next Steps"
            tip={SECTION_HELP.narrative_recs}
            iconKey="narrative_recs"
          >
            <NarrativeRecsBody narrative={intel.narrative} />
          </AuditAccordion>
        ) : null}

        <AuditAccordion label="Recommendations" tip={SECTION_HELP.recommendations} iconKey="recommendations">
          <RecommendationsBody recommendations={result.recommendations} />
        </AuditAccordion>
      </section>

      {/* 4. CTA */}
      <CtaBox />

      {/* 5. Supplementary — change + page inventory */}
      <section className="space-y-3">
        {(previous || trend.length >= 2) && (
          <AuditAccordion label="Change Since Last Audit" tip={SECTION_HELP.change} iconKey="change">
            {trend.length >= 2 && <ScoreTrendChart trend={trend} categories={trendCategories} />}
            {previous && (
              <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${trend.length >= 2 ? 'mt-5' : ''}`}>
                <div className="flex items-center justify-between rounded-xl border border-border-strong bg-surface-page px-4 py-3">
                  <p className="font-heading text-sm font-semibold text-text-primary">Overall</p>
                  <Delta current={result.overall_score} previous={previous.overall_score} />
                </div>
                {CATEGORY_META.map(({ key, label }) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-xl border border-border-default bg-surface-page px-4 py-3"
                  >
                    <p className="font-heading text-sm font-semibold text-text-primary">{label}</p>
                    <Delta
                      current={result.category_scores[key].score}
                      previous={previous.category_scores?.[key]?.score ?? null}
                    />
                  </div>
                ))}
              </div>
            )}
          </AuditAccordion>
        )}

        <AuditAccordion label="Page Inventory" tip={SECTION_HELP.page_inventory} iconKey="page_inventory">
          <PageInventoryBody pages={result.page_analysis_summary} />
        </AuditAccordion>
      </section>

      <footer className="pt-2 text-center">
        <p className="font-body text-xs text-text-muted">
          Audit generated by Revaltus · {runDate}
        </p>
      </footer>
    </div>
  )
}

// ── Hero / dashboard / accordion primitives ──────────────────────────────────

function TopRecommendations({
  items,
}: {
  items: Array<{ title: string; detail: string; token: SemanticToken }>
}) {
  if (!items.length) return null
  return (
    <div className="mt-6 rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 p-5">
      <h3 className="font-heading text-xs font-semibold uppercase tracking-wide text-brand-navy">
        Top Recommendations
      </h3>
      <ul className="mt-3 space-y-2.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-3 font-body text-sm text-text-primary">
            <span
              className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-heading text-[11px] font-bold text-text-inverse ${TOKEN_BG[it.token]}`}
            >
              {i + 1}
            </span>
            <span>
              <span className="font-semibold">{it.title}</span>
              {it.detail ? <> — {it.detail}</> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DashboardCard({ card }: { card: DashboardBucket }) {
  const token = tokenForScore(card.score)
  return (
    <div className="rounded-xl border border-border-default bg-surface-page px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-heading text-sm font-semibold text-text-primary">{card.label}</p>
        <GradeBadge score={card.score} />
      </div>
      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-border-default">
        <div className={`h-2 rounded-full ${TOKEN_BG[token]}`} style={{ width: `${card.score ?? 0}%` }} />
      </div>
    </div>
  )
}

/** Per-category grade chips for a composite card, so the weighted headline is
 * explained by its parts. */
function MemberGrades({ members }: { members: Array<{ label: string; score: number | null }> }) {
  if (!members.length) return null
  return (
    <div className="mb-1 flex flex-wrap gap-x-4 gap-y-2">
      {members.map((m, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className="font-heading text-xs font-semibold text-text-secondary">{m.label}</span>
          <GradeBadge score={m.score} />
        </span>
      ))}
    </div>
  )
}

/** "What This Means" labeled narrative block — matches the design target. */
function WhatThisMeans({ text }: { text?: string }) {
  if (!text) return null
  return (
    <div className="mb-1 rounded-r-md border-l-[3px] border-brand-cyan bg-surface-subtle px-4 py-3">
      <p className="font-heading text-[11px] font-bold uppercase tracking-wide text-brand-cyan">
        What This Means
      </p>
      <p className="mt-1 font-body text-sm text-text-secondary">{text}</p>
    </div>
  )
}

/** One accordion for a dashboard card, dispatching on its kind. Intel cards
 * render their rich body; composite cards merge their member findings; the
 * tech-stack card renders the stack (domain folds into Site Health). */
function BucketSection({
  result,
  bucket,
  sectionCommentary,
}: {
  result: AuditResult
  bucket: DashboardBucket
  sectionCommentary: Record<string, string>
}) {
  const intel = result.intelligence
  const wtm =
    bucket.kind === 'composite'
      ? bucket.members.map((k) => sectionCommentary[k]).filter(Boolean).join(' ') || undefined
      : bucket.kind === 'tech_stack'
        ? sectionCommentary.tech_stack ?? intel?.tech_stack?.commentary
        : sectionCommentary[bucket.key]

  let body: ReactNode = null
  if (bucket.kind === 'intel') {
    if (bucket.key === 'target_market' && intel?.target_market) {
      body = (
        <>
          <SubScores sub={intel.target_market.sub_scores} />
          <Commentary text={intel.target_market.commentary} />
        </>
      )
    } else if (bucket.key === 'competitive' && intel?.competitive) {
      body = <CompetitiveBody data={intel.competitive} />
    } else if (bucket.key === 'niche_services' && intel?.niche_services) {
      body = <NicheServicesBody data={intel.niche_services} />
    }
  } else if (bucket.kind === 'tech_stack') {
    const flags = asArray(intel?.tech_stack?.risk_flags).length
    body = (
      <>
        <p className="font-body text-xs text-text-muted">
          Grade reflects {flags} notable dependency risk{flags === 1 ? '' : 's'}.
        </p>
        <TechDomainBody tech={intel?.tech_stack} />
      </>
    )
  } else {
    const rows = bucket.members.flatMap((k) => findingRows(result.findings[k]))
    if (bucket.key === 'site_health') rows.push(...siteHealthExtraRows(result))
    body = (
      <>
        <MemberGrades members={bucketMemberGrades(result, bucket)} />
        <FindingsDl rows={rows} />
      </>
    )
  }

  return (
    <AuditAccordion label={bucket.label} tip={SECTION_HELP[bucket.key]} score={bucket.score} iconKey={bucket.key}>
      <WhatThisMeans text={wtm} />
      {body}
    </AuditAccordion>
  )
}

// Info icon + CSS-only tooltip (no JS) so it works in both the React page and
// the standalone HTML export. The icon is focusable for keyboard users; the
// bubble shows on hover or focus-within. The accordion must NOT use
// overflow-hidden or the bubble would be clipped — rounding is handled with
// rounded-[inherit] on the summary instead.
function InfoTip({ text }: { text: string }) {
  return (
    <span className="group/tip relative inline-flex">
      <span
        tabIndex={0}
        role="img"
        aria-label={text}
        className="inline-flex text-text-muted transition-colors hover:text-brand-cyan focus-visible:text-brand-cyan focus:outline-none"
      >
        <Info className="h-3.5 w-3.5" />
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-60 -translate-x-1/2 rounded-md bg-brand-navy px-3 py-2 text-left text-xs font-body font-normal normal-case leading-snug tracking-normal text-text-inverse opacity-0 shadow-elevated transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  )
}

function AuditAccordion({
  label,
  tip,
  score,
  iconKey,
  defaultOpen,
  children,
}: {
  label: string
  tip?: string
  score?: number | null
  iconKey?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <details className={`${cardClass} group`} {...(defaultOpen ? { open: true } : {})}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[inherit] p-5 transition-colors marker:hidden hover:bg-surface-subtle [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2.5">
          {iconKey && <IconChip iconKey={iconKey} />}
          <h3 className="text-base font-heading font-semibold text-brand-navy">{label}</h3>
          {tip && <InfoTip text={tip} />}
        </span>
        <span className="flex items-center gap-3">
          {score != null && <MiniGauge score={score} />}
          {score !== undefined && <GradeBadge score={score ?? null} />}
          <ChevronDown className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t border-border-default p-6 pt-5">{children}</div>
    </details>
  )
}

function FindingsDl({ rows }: { rows: Array<{ label: string; value: string }> }) {
  if (!rows.length) return null
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {rows.map((row, i) => (
        <MetricRow key={i} label={row.label} value={row.value} />
      ))}
    </dl>
  )
}

/** A finding/sub-score row: label + value on one line, with a grade-colored bar
 * beneath when the value is a bar-able quantity (percentage or 0–10 score). */
function MetricRow({ label, value }: { label: string; value: string }) {
  const pct = barPercent(label, value)
  return (
    <div className="border-b border-border-default py-1.5 last:border-0">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="font-body text-sm text-text-secondary">{label}</dt>
        <dd className="font-heading text-sm font-semibold text-text-primary text-right">{value}</dd>
      </div>
      {pct !== null && <MetricBar pct={pct} />}
    </div>
  )
}

function CtaBox() {
  return (
    <section className="rounded-xl bg-brand-navy p-8 text-center shadow-elevated">
      <h2 className="font-heading text-xl font-bold text-text-inverse">
        Ready to turn these findings into results?
      </h2>
      <p className="mx-auto mt-2 max-w-xl font-body text-sm text-text-inverse/70">
        Revaltus turns audit insights into a prioritized plan — plus the content, technical fixes,
        and search-visibility work to execute it.
      </p>
      <a
        href="https://revaltus.com"
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex items-center justify-center rounded-pill bg-brand-cyan px-6 py-2.5 font-heading text-sm font-semibold text-text-inverse transition-colors hover:bg-brand-cyan-dark"
      >
        Let&rsquo;s talk
      </a>
    </section>
  )
}

function PageInventoryBody({ pages }: { pages: PageSummary[] }) {
  return (
    <>
      {pages.length > 0 && <PageInventoryCharts stats={pageInventoryStats(pages)} />}
      <p className="font-body text-xs text-text-muted">{pages.length} pages analyzed</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="border-b border-border-default bg-surface-header text-left">
              {['URL', 'Title', 'Status', 'H1', 'Schema', 'Words', 'Issues'].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr
                key={p.url}
                className="border-b border-border-default last:border-0 hover:bg-surface-subtle"
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
    </>
  )
}

const EFFORT_CLASS: Record<string, string> = {
  Low: 'bg-success/10 text-success',
  Medium: 'bg-warning-strong/10 text-warning-strong',
  High: 'bg-error/10 text-error',
}

function RecommendationsBody({ recommendations }: { recommendations: Recommendation[] }) {
  return (
    <>
      <RecommendationsBreakdown stats={recommendationStats(recommendations)} />
      <p className="font-body text-xs text-text-muted">
        Sorted by priority, then effort. {recommendations.length} total.
      </p>
      <ul className="mt-4 space-y-3">
        {recommendations.map((r, i) => (
          <li
            key={i}
            className={`rounded-xl border border-border-default border-l-4 bg-surface-page p-4 ${
              r.priority === 'critical' ? 'border-l-error' : 'border-l-warning'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] ${
                  r.priority === 'critical'
                    ? 'bg-error/10 text-error'
                    : 'bg-warning-strong/10 text-warning-strong'
                }`}
              >
                {r.priority === 'critical' ? 'Critical' : 'Warning'}
              </span>
              <span className="font-body text-xs text-text-muted">{r.category}</span>
              <span
                className={`ml-auto inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] ${EFFORT_CLASS[r.effort]}`}
              >
                {r.effort} effort
              </span>
            </div>
            <p className="mt-2 font-heading text-sm font-semibold text-text-primary">{r.title}</p>
            <p className="mt-1 font-body text-sm text-text-secondary">{r.detail}</p>
          </li>
        ))}
      </ul>
    </>
  )
}

// ── Intelligence layer ───────────────────────────────────────────────────────

const intelSubHeading = 'mt-5 font-heading text-sm font-semibold text-brand-navy'
const intelTableHead =
  'px-4 py-2 font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary text-left'
const intelTd = 'px-4 py-2 align-top text-text-secondary'

// The intelligence layer is an editable JSONB blob (Edit-with-AI can write a
// scalar where an array belongs, or leave `null` holes from a sparse-index
// write). Coerce any array field to a clean array so the report renders a
// degraded section instead of throwing and 500-ing the whole route.
function asArray<T>(x: unknown): T[] {
  return Array.isArray(x) ? (x.filter((v) => v != null) as T[]) : []
}

function Commentary({ text }: { text?: string }) {
  if (!text) return null
  return <p className="mt-3 font-body text-sm text-text-secondary">{text}</p>
}

function SubScores({ sub }: { sub: Record<string, number> }) {
  const rows = subScoreRows(sub)
  if (!rows.length) return null
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {rows.map((row, i) => (
        <MetricRow key={i} label={row.label} value={row.value} />
      ))}
    </dl>
  )
}

function IntelTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm font-body">
        <thead>
          <tr className="border-b border-border-default bg-surface-header">
            {headers.map((h) => (
              <th key={h} className={intelTableHead}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border-default last:border-0 hover:bg-surface-subtle">
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

function NicheServicesBody({ data, commentary }: { data: NicheServicesIntelligence; commentary?: string }) {
  const detected = asArray<(typeof data.detected_niches)[number]>(data.detected_niches)
  const invisible = asArray<(typeof data.invisible_niches)[number]>(data.invisible_niches)
  const services = asArray<(typeof data.services_analysis)[number]>(data.services_analysis)
  const improvements = asArray<string>(data.top_improvements)
  return (
    <>
      <SubScores sub={data.sub_scores} />
      <Commentary text={data.commentary} />
      <Commentary text={commentary} />
      {detected.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Detected Niches</h4>
          <ul className="mt-2 space-y-1.5 font-body text-sm text-text-secondary">
            {detected.map((d, i) => (
              <li key={i}>
                <span className="font-semibold text-text-primary">{d.name}</span>{' '}
                <span className="text-text-muted">({signalLabel(d.signal)})</span> — {d.note}
              </li>
            ))}
          </ul>
        </>
      )}
      {invisible.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-xl border border-brand-cyan/40 bg-brand-cyan/[0.06] shadow-subtle">
          <div className="flex items-center gap-2.5 border-b border-brand-cyan/20 bg-brand-cyan/10 px-4 py-3">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-cyan text-text-inverse">
              <Lightbulb className="h-4 w-4" strokeWidth={2.25} aria-hidden />
            </span>
            <h4 className="font-heading text-sm font-bold text-brand-navy">
              Invisible but High-Opportunity Niches
            </h4>
            <span className="ml-auto inline-flex items-center rounded-full bg-brand-cyan px-2.5 py-0.5 font-heading text-[11px] font-semibold uppercase tracking-wide text-text-inverse">
              {invisible.length} Untapped
            </span>
          </div>
          <ul className="divide-y divide-brand-cyan/15">
            {invisible.map((d, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 px-4 py-2.5 font-body text-sm text-text-secondary"
              >
                <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" strokeWidth={2.25} aria-hidden />
                <span>
                  <span className="font-semibold text-text-primary">{d.name}</span> — {d.opportunity}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {services.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Services Communication Analysis</h4>
          <IntelTable
            headers={['Service', 'Clarity', 'Framing', 'Audience', 'Rewrite Direction']}
            rows={services.map((s) => [s.service, s.clarity, s.framing, s.audience, s.rewrite_direction])}
          />
        </>
      )}
      {improvements.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Top Highest-Impact Improvements</h4>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 font-body text-sm text-text-secondary">
            {improvements.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </>
      )}
    </>
  )
}

function CompetitiveBody({ data, commentary }: { data: CompetitiveIntelligence; commentary?: string }) {
  const keywordRankings = asArray<(typeof data.keyword_rankings)[number]>(data.keyword_rankings)
  return (
    <>
      <SubScores sub={data.sub_scores} />
      {keywordRankings.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Keyword Visibility</h4>
          <KeywordRankChart data={keywordRankBars(keywordRankings)} />
        </>
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
    </>
  )
}

function TechDomainBody({
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
    const frameworks = asArray<string>(tech.frameworks)
    if (frameworks.length) rows.push(['Frameworks', frameworks.join(', ')])
  }
  if (domain) {
    if (domain.registered) rows.push(['Domain Registered', domain.registered])
    if (domain.age_years !== null) rows.push(['Domain Age', `${domain.age_years} years`])
    if (domain.last_updated) rows.push(['Last Content Update', domain.last_updated])
  }
  return (
    <>
      {rows.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map(([k, v], i) => (
            <div key={i} className="flex items-baseline justify-between gap-4 border-b border-border-default py-1.5 last:border-0">
              <dt className="font-body text-sm text-text-secondary">{k}</dt>
              <dd className="font-heading text-sm font-semibold text-text-primary text-right">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {tech && asArray<string>(tech.risk_flags).length > 0 && (
        <>
          <h4 className={intelSubHeading}>Flags</h4>
          <ul className="mt-2 space-y-1.5 font-body text-sm text-error">
            {asArray<string>(tech.risk_flags).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}
      <Commentary text={tech?.commentary} />
      <Commentary text={commentary} />
    </>
  )
}

function ContentLibraryBody({ data, commentary }: { data: ContentLibraryIntelligence; commentary?: string }) {
  const formats = asArray<(typeof data.formats)[number]>(data.formats)
  const recommendations = asArray<string>(data.recommendations)
  return (
    <>
      <p className="font-body text-xs text-text-muted">
        {data.total_pieces} published piece{data.total_pieces === 1 ? '' : 's'}
      </p>
      {formats.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Content by Format</h4>
          <ContentFormatsChart formats={formats} />
        </>
      )}
      <Commentary text={data.syndication_assessment} />
      {recommendations.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Recommendations</h4>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 font-body text-sm text-text-secondary">
            {recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}
      <Commentary text={commentary} />
    </>
  )
}

const NARRATIVE_PRIORITY_CLASS: Record<string, string> = {
  High: 'bg-error/10 text-error',
  Medium: 'bg-warning-strong/10 text-warning-strong',
  Low: 'bg-success/10 text-success',
}

function NarrativeRecsBody({ narrative }: { narrative: NarrativeIntelligence }) {
  const recommendations = asArray<(typeof narrative.recommendations)[number]>(narrative.recommendations)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm font-body">
        <thead>
          <tr className="border-b border-border-default bg-surface-header">
            {['Priority', 'Issue & Impact', 'Section', 'Revaltus Service'].map((h) => (
              <th key={h} className={intelTableHead}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {recommendations.map((r, i) => (
            <tr
              key={i}
              className="border-b border-border-default last:border-0 hover:bg-surface-subtle"
            >
              <td className="px-4 py-2 align-top">
                <span
                  className={`inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] ${
                    NARRATIVE_PRIORITY_CLASS[r.priority] ?? 'bg-warning-strong/10 text-warning-strong'
                  }`}
                >
                  {r.priority}
                </span>
              </td>
              <td className="px-4 py-2 align-top">
                <span className="font-heading font-semibold text-text-primary">{r.title}</span>
                {r.business_impact && (
                  <p className="mt-1 text-text-secondary">{r.business_impact}</p>
                )}
              </td>
              <td className="px-4 py-2 align-top text-text-secondary">
                {inferSection(`${r.title} ${r.business_impact}`)}
              </td>
              <td className="px-4 py-2 align-top text-text-secondary">{r.counting_five_help}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const SOCIAL_STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-success/10 text-success' },
  dormant: { label: 'Dormant', cls: 'bg-warning-strong/10 text-warning-strong' },
  not_found: { label: 'Not found', cls: 'bg-error/10 text-error' },
  unknown: { label: 'Unverified', cls: 'bg-brand-cyan/10 text-brand-cyan-dark' },
}

function SocialPresenceBody({ data, commentary }: { data: SocialPresenceReport; commentary?: string }) {
  const profiles = asArray<SocialProfileAssessment>(data.profiles)
  if (!profiles.length) return <Commentary text={commentary} />
  return (
    <>
      <p className="font-body text-xs text-text-muted">Presence &amp; quality — not scored</p>
      {data.summary && <p className="mt-2 font-body text-sm text-text-secondary">{data.summary}</p>}
      <div className="mt-3 divide-y divide-border-default">
        {profiles.map((p, i) => {
          const status = SOCIAL_STATUS_STYLE[p.status] ?? SOCIAL_STATUS_STYLE.unknown
          const metrics = formatSocialMetrics(p.metrics)
          return (
            <div key={i} className="py-3 font-body text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold text-text-primary">
                  {SOCIAL_PLATFORM_LABELS[p.platform] ?? p.platform}
                </span>
                <span className={`inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] ${status.cls}`}>{status.label}</span>
                <span className="text-xs text-text-muted">{p.usefulness} value</span>
              </div>
              {p.url && (
                <div className="mt-0.5">
                  <a
                    href={safeHref(p.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-brand-cyan hover:underline"
                  >
                    {p.url}
                  </a>
                </div>
              )}
              {metrics && <div className="mt-0.5 text-xs text-text-muted">{metrics}</div>}
              {p.roomForImprovement && <div className="mt-0.5 text-text-secondary">{p.roomForImprovement}</div>}
            </div>
          )
        })}
      </div>
      <Commentary text={commentary} />
    </>
  )
}

const FOOTPRINT_STYLE: Record<string, { label: string; cls: string }> = {
  strong: { label: 'Strong footprint', cls: 'bg-success/10 text-success' },
  moderate: { label: 'Moderate footprint', cls: 'bg-brand-cyan/10 text-brand-cyan-dark' },
  minimal: { label: 'Minimal footprint', cls: 'bg-warning-strong/10 text-warning-strong' },
}

function TeamSocialBody({ data, commentary }: { data: TeamSocialReport; commentary?: string }) {
  const members = asArray<TeamSocialReport['members'][number]>(data.members)
  if (!members.length) return <Commentary text={commentary} />
  const teamNiches = asArray<string>(data.teamNicheOpportunities)
  return (
    <>
      <p className="font-body text-xs text-text-muted">Team footprint &amp; niche expertise — not scored</p>
      {data.summary && <p className="mt-2 font-body text-sm text-text-secondary">{data.summary}</p>}

      {teamNiches.length > 0 && (
        <div className="mt-3 rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 p-4">
          <p className="font-heading text-xs font-semibold uppercase tracking-wide text-brand-navy">
            Untapped Niche Content From Team Expertise
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 font-body text-sm text-text-secondary">
            {teamNiches.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 divide-y divide-border-default">
        {members.map((m, i) => {
          const profiles = asArray<SocialProfileAssessment>(m.socialProfiles)
          const certs = asArray<string>(m.certifications)
          const niches = asArray<string>(m.nicheOpportunities)
          const footprint = FOOTPRINT_STYLE[m.footprint] ?? FOOTPRINT_STYLE.minimal
          return (
            <div key={i} className="py-3 font-body text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold text-text-primary">{m.name}</span>
                {m.title && <span className="text-text-muted">· {m.title}</span>}
                <span className={`inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] ${footprint.cls}`}>{footprint.label}</span>
              </div>
              {certs.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {certs.map((c, j) => (
                    <span key={j} className="inline-flex items-center rounded-badge bg-surface-page px-2 py-0.5 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] text-brand-navy">{c}</span>
                  ))}
                </div>
              )}
              {profiles.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {profiles.map((p, j) => {
                    const status = SOCIAL_STATUS_STYLE[p.status] ?? SOCIAL_STATUS_STYLE.unknown
                    return (
                      <div key={j} className="text-xs">
                        <span className="font-semibold text-text-primary">{SOCIAL_PLATFORM_LABELS[p.platform] ?? p.platform}</span>{' '}
                        <span className={`inline-flex items-center rounded-badge px-1.5 py-0.5 font-heading text-[9.5px] font-semibold uppercase tracking-[0.04em] ${status.cls}`}>{status.label}</span>
                        {p.url && (
                          <>
                            {' '}
                            <a href={safeHref(p.url)} target="_blank" rel="noopener noreferrer" className="break-all text-brand-cyan hover:underline">{p.url}</a>
                          </>
                        )}
                        {p.roomForImprovement && <div className="text-text-secondary">{p.roomForImprovement}</div>}
                      </div>
                    )
                  })}
                </div>
              )}
              {m.roomForImprovement && <div className="mt-1 text-text-secondary">{m.roomForImprovement}</div>}
              {niches.length > 0 && (
                <div className="mt-1 text-xs text-text-muted">
                  <span className="font-semibold text-brand-navy">Untapped niches: </span>
                  {niches.join(' · ')}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {data.membersDropped > 0 && (
        <p className="mt-2 font-body text-xs text-text-muted">
          {data.membersDropped} additional team member{data.membersDropped === 1 ? '' : 's'} found but not assessed.
        </p>
      )}
      <Commentary text={commentary} />
    </>
  )
}

function DigitalIntelBody({ data, commentary }: { data: DigitalIntelligence; commentary?: string }) {
  const rep = data.reputation && typeof data.reputation === 'object' ? data.reputation : null
  const gap = data.niche_gap && typeof data.niche_gap === 'object' ? data.niche_gap : null
  const personnel = asArray<(typeof data.personnel)[number]>(data.personnel)
  const affiliations = asArray<string>(data.affiliations)
  const contentFootprint = asArray<(typeof data.content_footprint)[number]>(data.content_footprint)
  const socialPresence = asArray<(typeof data.social_presence)[number]>(data.social_presence)
  const ratings = asArray<string>(rep?.ratings)
  const praise = asArray<string>(rep?.praise_themes)
  const concerns = asArray<string>(rep?.concern_themes)
  const gapExternal = asArray<string>(gap?.external)
  const gapOnSite = asArray<string>(gap?.on_site)
  const gapUnleveraged = asArray<string>(gap?.unleveraged)
  return (
    <>
      <p className="font-body text-xs text-text-muted">External research — not scored</p>

      {personnel.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Key Personnel</h4>
          <div className="mt-2 divide-y divide-border-default">
            {personnel.map((p, i) => {
              const associations = asArray<string>(p.associations)
              return (
              <div key={i} className="py-2.5 font-body text-sm">
                <div>
                  <span className="font-semibold text-text-primary">{p.name}</span> · {p.role}{' '}
                  <span className="text-text-muted">({p.footprint} footprint)</span>
                </div>
                {associations.length > 0 && (
                  <div className="text-xs text-text-muted">Associations: {associations.join(', ')}</div>
                )}
                {p.notes && <div className="text-text-secondary">{p.notes}</div>}
              </div>
              )
            })}
          </div>
        </>
      )}

      {rep && (rep.sentiment || ratings.length > 0 || praise.length > 0 || concerns.length > 0) && (
        <>
          <h4 className={intelSubHeading}>Reputation Signals</h4>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {rep.sentiment && <Field label="Sentiment" value={rep.sentiment} />}
            {ratings.length > 0 && <Field label="Ratings" value={ratings.join(', ')} />}
            {praise.length > 0 && <Field label="Praise" value={praise.join(', ')} />}
            {concerns.length > 0 && <Field label="Concerns" value={concerns.join(', ')} />}
          </dl>
        </>
      )}

      {affiliations.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Affiliations</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 font-body text-sm text-text-secondary">
            {affiliations.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </>
      )}

      {contentFootprint.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Content Footprint</h4>
          <IntelTable
            headers={['Type', 'Title', 'Source']}
            rows={contentFootprint.map((f) => [f.type, f.title, f.source])}
          />
        </>
      )}

      {socialPresence.length > 0 && (
        <>
          <h4 className={intelSubHeading}>Social Media Presence</h4>
          <ul className="mt-2 space-y-1.5 font-body text-sm text-text-secondary">
            {socialPresence.map((s, i) => (
              <li key={i}>
                <span className="font-semibold text-text-primary">{s.platform}</span> — {s.status}
                {s.detail ? ` · ${s.detail}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}

      {gap && (gapExternal.length > 0 || gapOnSite.length > 0 || gapUnleveraged.length > 0) && (
        <>
          <h4 className={intelSubHeading}>External vs. Website Niche Gap</h4>
          {gapOnSite.length > 0 && (
            <p className="mt-2 font-body text-sm text-text-secondary">
              <span className="font-semibold text-text-primary">On website:</span> {gapOnSite.join(', ')}
            </p>
          )}
          {gapExternal.length > 0 && (
            <p className="mt-1 font-body text-sm text-text-secondary">
              <span className="font-semibold text-text-primary">Found externally:</span> {gapExternal.join(', ')}
            </p>
          )}
          {gapUnleveraged.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 font-body text-sm text-text-secondary">
              {gapUnleveraged.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          )}
        </>
      )}

      <Commentary text={commentary} />
    </>
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
