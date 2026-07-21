'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type {
  AuditBatchStatusResponse,
  AuditBatchRunView,
  RunHealth,
  IssueKind,
} from '@/app/api/audit-batches/[id]/status/route'

const HEALTH_META: Record<RunHealth, { icon: string; cls: string; label: string }> = {
  done: { icon: '●', cls: 'text-success', label: 'Complete' },
  warning: { icon: '▲', cls: 'text-warning-strong', label: 'Completed with issue' },
  error: { icon: '✗', cls: 'text-error', label: 'Failed' },
  running: { icon: '◌', cls: 'text-brand-cyan-dark animate-pulse', label: 'Running…' },
  queued: { icon: '○', cls: 'text-text-muted', label: 'Queued' },
}

// Troubleshooting guidance keyed on the server-classified issue kind, so the
// copy stays in one place and never re-parses raw error strings.
const TROUBLESHOOTING: Record<Exclude<IssueKind, null>, string[]> = {
  crawl_failed: [
    'Open the URL in a browser to confirm the site is live and publicly reachable.',
    'Check for typos and the right scheme (some sites only answer on https, others on www).',
    'The site may sit behind a login, staging password, or a firewall/WAF that blocks crawlers.',
    'If it is a single-page or heavily JavaScript-rendered site, the crawler may not find linked pages.',
    'Fix the URL or access issue, then Retry.',
  ],
  timeout: [
    'The site is slow or very large and the audit ran past its time budget.',
    'Lower “Max pages” for a re-run, or Retry once — this is often transient.',
  ],
  thin_crawl: [
    'Only the homepage was reachable, so the report covers that page only.',
    'Internal links may be JavaScript-rendered, or the site is a genuine one-pager.',
    'The scores are still valid for what was crawled; Retry if you expected more pages.',
  ],
  niche_incomplete: [
    'The AI could not extract the services/niche from the page copy.',
    'The rest of the report (scores, findings, pages) is complete.',
    'Retry, or review whether the site clearly states what it does.',
  ],
  worker_error: [
    'An unexpected error interrupted this run — usually transient.',
    'Retry. If it keeps failing, run it as a single audit to see the full error.',
  ],
  unknown: [
    'The audit failed with an unexpected error (shown above).',
    'Retry. If it persists, run it as a single audit for more detail.',
  ],
}

function StatChip({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded-xl border border-border-default bg-surface-card px-3 py-2 text-center shadow-subtle">
      <div className={`font-heading text-lg font-bold ${cls}`}>{value}</div>
      <div className="font-body text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
    </div>
  )
}

export default function AuditBatchProgress({ batchId }: { batchId: string }) {
  const [data, setData] = useState<AuditBatchStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [retrying, setRetrying] = useState<Record<string, boolean>>({})
  // Bumped after a retry to restart polling (the interval self-stops at rest).
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    let active = true
    let intervalId: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      try {
        const res = await fetch(`/api/audit-batches/${batchId}/status`)
        if (!res.ok) {
          if (res.status === 404 || res.status === 403) {
            if (active) setNotFound(true)
            if (intervalId) clearInterval(intervalId)
          }
          return
        }
        const json = (await res.json()) as AuditBatchStatusResponse
        if (!active) return
        setData(json)
        setLoading(false)
        if (json.counts.queued === 0 && json.counts.running === 0 && intervalId) clearInterval(intervalId)
      } catch {
        // Transient — the next tick retries.
      }
    }

    poll()
    intervalId = setInterval(poll, 2500)
    return () => {
      active = false
      if (intervalId) clearInterval(intervalId)
    }
  }, [batchId, reloadNonce])

  async function retry(runId: string) {
    setRetrying((m) => ({ ...m, [runId]: true }))
    try {
      // Re-run a single audit through the existing per-audit route.
      const res = await fetch(`/api/audits/${runId}/run`, { method: 'POST' })
      if (res.ok) setReloadNonce((n) => n + 1)
    } catch {
      // Transient — the user can click again.
    } finally {
      setRetrying((m) => ({ ...m, [runId]: false }))
    }
  }

  if (notFound) {
    return (
      <main className="p-8">
        <p className="rounded-card bg-error/10 px-3 py-2 text-sm text-error">Batch not found or not accessible.</p>
        <Link href="/admin/audits" className="mt-4 inline-block text-sm text-brand-cyan hover:underline">
          &larr; Back to audits
        </Link>
      </main>
    )
  }

  if (loading || !data) {
    return <main className="p-8 font-body text-sm text-text-muted">Loading…</main>
  }

  const { counts } = data
  const inFlight = counts.queued + counts.running

  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/admin/audits" className="text-sm text-brand-cyan hover:underline">
        &larr; Back to audits
      </Link>
      <h1 className="mb-1 mt-2 font-heading text-2xl font-bold text-brand-navy">
        {data.label ?? 'Batch audit'}
      </h1>
      <p className="mb-5 font-body text-sm text-text-secondary">
        {counts.done + counts.warning}/{counts.total} done
        {inFlight > 0 ? ` · ${inFlight} to go, running one at a time…` : ' · finished'}
      </p>

      <div className="mb-6 grid grid-cols-5 gap-2">
        <StatChip label="Complete" value={counts.done} cls="text-success" />
        <StatChip label="Issues" value={counts.warning} cls="text-warning-strong" />
        <StatChip label="Failed" value={counts.error} cls="text-error" />
        <StatChip label="Running" value={counts.running} cls="text-brand-cyan-dark" />
        <StatChip label="To do" value={counts.queued} cls="text-text-muted" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border-default bg-surface-card shadow-subtle">
        <table className="w-full font-body text-sm">
          <thead>
            <tr className="border-b border-border-default bg-[#FBFCFD]">
              <th className="px-4 py-3 text-left font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Site
              </th>
              <th className="px-4 py-3 text-left font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Status
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data.runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                expanded={!!expanded[run.id]}
                onToggle={() => setExpanded((m) => ({ ...m, [run.id]: !m[run.id] }))}
                retrying={!!retrying[run.id]}
                onRetry={() => retry(run.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}

function RunRow({
  run,
  expanded,
  onToggle,
  retrying,
  onRetry,
}: {
  run: AuditBatchRunView
  expanded: boolean
  onToggle: () => void
  retrying: boolean
  onRetry: () => void
}) {
  const meta = HEALTH_META[run.health]
  const hasIssue = run.health === 'error' || run.health === 'warning'
  const steps = run.issueKind ? TROUBLESHOOTING[run.issueKind] : null

  return (
    <>
      <tr className={`border-b border-border-default ${!expanded ? 'last:border-0' : ''} hover:bg-surface-subtle`}>
        <td className="px-4 py-3">
          <div className="truncate font-body font-semibold text-text-primary">{run.domain}</div>
          <div className="mt-0.5 truncate text-xs text-text-muted">{run.url}</div>
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center gap-1.5 font-heading text-xs font-semibold ${meta.cls}`}>
            <span>{meta.icon}</span>
            {meta.label}
          </span>
          {run.health === 'running' && run.statusDetail && (
            <div className="mt-0.5 text-xs text-text-muted">{run.statusDetail}</div>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            {hasIssue && steps && (
              <button
                type="button"
                onClick={onToggle}
                className="rounded-pill border border-border-default px-3 py-1 font-heading text-xs font-semibold text-text-secondary transition-all hover:bg-surface-subtle"
              >
                {expanded ? 'Hide' : 'Troubleshoot'}
              </button>
            )}
            {run.health === 'error' && (
              <button
                type="button"
                onClick={onRetry}
                disabled={retrying}
                className="rounded-pill bg-brand-cyan px-3 py-1 font-heading text-xs font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {retrying ? 'Retrying…' : 'Retry'}
              </button>
            )}
            {(run.health === 'done' || run.health === 'warning') && (
              <Link
                href={`/admin/audits/${run.id}`}
                className="inline-flex items-center rounded-pill border border-success/40 px-3 py-1 font-heading text-xs font-semibold text-success transition-all hover:bg-success/10"
              >
                {run.overallGrade ? `Report · ${run.overallGrade}` : 'Report'}
              </Link>
            )}
          </div>
        </td>
      </tr>
      {hasIssue && expanded && (
        <tr className="border-b border-border-default last:border-0">
          <td colSpan={3} className="px-4 pb-4 pt-0">
            <div
              className={`rounded-xl border p-3 ${
                run.health === 'error'
                  ? 'border-error/30 bg-error/5'
                  : 'border-warning/40 bg-warning/5'
              }`}
            >
              {run.issue && (
                <p
                  className={`font-body text-xs ${run.health === 'error' ? 'text-error' : 'text-warning-strong'}`}
                >
                  {run.issue}
                </p>
              )}
              {steps && (
                <ol className="mt-2 list-decimal space-y-1 pl-4 font-body text-xs text-text-secondary">
                  {steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
