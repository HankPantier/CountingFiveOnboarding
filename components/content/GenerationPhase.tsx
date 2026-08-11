'use client'

import { useState, useEffect } from 'react'
import MarkdownPreviewModal from './MarkdownPreviewModal'

type PageStatus = {
  id: string
  url: string
  title: string
  status: string
  errorMessage?: string | null
  parent?: string
  approved?: boolean
  needsClientReview?: boolean
  clientApproved?: boolean
  wordCountActual?: number | null
  wordCountTarget?: number | null
}

// Depth in the sitemap tree, capped to guard against accidental cycles.
function depthOf(url: string, parentByUrl: Map<string, string | undefined>): number {
  let d = 0
  let cur = parentByUrl.get(url)
  while (cur && d < 8) {
    d++
    cur = parentByUrl.get(cur)
  }
  return d
}

type GenStatus = {
  total: number
  complete: number
  running: number
  error: number
  approved: number
  needsClientReview: number
  clientApproved: number
  pages: PageStatus[]
}

const STATUS_ICONS: Record<string, { icon: string; cls: string; title: string }> = {
  pending:  { icon: '○', cls: 'text-text-muted', title: 'Pending — not yet generated' },
  running:  { icon: '◌', cls: 'text-info animate-pulse', title: 'Running — Claude is generating this page now' },
  complete: { icon: '●', cls: 'text-success', title: 'Complete — content has been generated' },
  error:    { icon: '✗', cls: 'text-error', title: 'Error — generation failed; check server logs and re-run' },
}

function wordCountBadge(actual: number | null | undefined, target: number | null | undefined): { label: string; cls: string; title: string } | null {
  if (actual == null) return null
  if (!target) {
    return {
      label: `${actual} words`,
      cls: 'text-text-muted bg-surface-subtle',
      title: `${actual} words generated (no target was set for this outline)`,
    }
  }
  const variance = (actual - target) / target
  const pct = Math.round(variance * 100)
  if (Math.abs(variance) > 0.25) {
    return {
      label: `⚠ ${actual} / ${target} (${pct >= 0 ? '+' : ''}${pct}%)`,
      cls: 'text-warning-strong bg-warning/10',
      title: `${actual} words generated vs target of ${target} (${pct >= 0 ? '+' : ''}${pct}% off target). Flagged when actual is more than ±25% from target — review whether the content is too thin or too verbose.`,
    }
  }
  return {
    label: `${actual} / ${target}`,
    cls: 'text-text-muted bg-surface-subtle',
    title: `${actual} words generated vs target of ${target} (${pct >= 0 ? '+' : ''}${pct}%). Within the acceptable ±25% range.`,
  }
}

export default function GenerationPhase({
  contentJobId,
  jobPhase,
}: {
  contentJobId: string
  jobPhase: number
}) {
  const [status, setStatus] = useState<GenStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [pollNonce, setPollNonce] = useState(0)
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set())
  const [previewPageId, setPreviewPageId] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [restartError, setRestartError] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(`/api/content-jobs/${contentJobId}/generation-status`)
        if (cancelled || !res.ok) return
        const data = await res.json()
        setStatus(data)
        setLoading(false)
        if (data.total > 0 && data.complete + data.error >= data.total && data.running === 0) {
          clearInterval(intervalId)
        }
      } catch {
        // Retry on next poll
      }
    }

    const intervalId = setInterval(poll, 5000)
    poll()
    return () => { cancelled = true; clearInterval(intervalId) }
  }, [contentJobId, pollNonce])

  const setAction = (key: string, on: boolean) => {
    setPendingActions(prev => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const toggleApprove = async (page: PageStatus, next: boolean) => {
    setAction(`approve:${page.id}`, true)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_approved_content: next }),
      })
      if (res.ok) setPollNonce(n => n + 1)
    } finally {
      setAction(`approve:${page.id}`, false)
    }
  }

  const restartGeneration = async () => {
    setRestarting(true)
    setRestartError(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/generate`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Restart failed')
      }
      setPollNonce(n => n + 1)
    } catch (err) {
      setRestartError(err instanceof Error ? err.message : 'Restart failed')
    } finally {
      setRestarting(false)
    }
  }

  const copyReviewLink = async () => {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '') || (typeof window !== 'undefined' ? window.location.origin : '')
    const link = `${base}/review/${contentJobId}`
    try {
      await navigator.clipboard.writeText(link)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      // Ignore — most likely the user denied clipboard permission
    }
  }

  const toggleClientReviewFlag = async (page: PageStatus, next: boolean) => {
    setAction(`flag:${page.id}`, true)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ needs_client_review: next }),
      })
      if (res.ok) setPollNonce(n => n + 1)
    } finally {
      setAction(`flag:${page.id}`, false)
    }
  }

  // Retry a failed page: same regenerate endpoint, but no "replace approved
  // content" confirm since an errored page has nothing worth keeping.
  const retryPage = async (page: PageStatus) => {
    setAction(`regen:${page.id}`, true)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/pages/${page.id}/regenerate`, {
        method: 'POST',
      })
      if (res.ok) setPollNonce(n => n + 1)
    } finally {
      setAction(`regen:${page.id}`, false)
    }
  }

  const regenerate = async (page: PageStatus) => {
    const warning =
      jobPhase === 6
        ? `This client's content is already COMPLETE. Regenerating "${page.title}" will replace the finished content and reset approval — you'll need to re-publish. Continue?`
        : page.approved
          ? `Regenerate "${page.title}"? The current approved content will be replaced and approval reset.`
          : `Regenerate "${page.title}"? The current draft will be replaced.`
    if (!window.confirm(warning)) return
    setAction(`regen:${page.id}`, true)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/pages/${page.id}/regenerate`, {
        method: 'POST',
      })
      if (res.ok) setPollNonce(n => n + 1)
    } finally {
      setAction(`regen:${page.id}`, false)
    }
  }

  if (loading) {
    return (
      <div className="py-4 text-center">
        <div className="text-sm text-text-muted font-body">Loading generation status...</div>
      </div>
    )
  }

  if (!status || status.total === 0) {
    return (
      <div className="py-4 text-center">
        <div className="text-sm text-text-muted font-body">No pages queued for generation.</div>
      </div>
    )
  }

  const pct = status.total > 0 ? Math.round((status.complete / status.total) * 100) : 0
  const isRunning = status.running > 0 || (status.complete + status.error < status.total)
  const allAdminApproved = status.approved === status.complete && status.complete > 0
  const allClientApproved = status.needsClientReview === 0 || status.clientApproved === status.needsClientReview
  const allApproved = allAdminApproved && allClientApproved

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-body text-text-muted">
          {status.needsClientReview > 0
            ? `${status.clientApproved} of ${status.needsClientReview} flagged pages approved by client`
            : 'No pages flagged for client review'}
        </div>
        <button
          type="button"
          onClick={copyReviewLink}
          disabled={status.needsClientReview === 0}
          className="text-xs font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {linkCopied ? 'Copied!' : 'Copy review link'}
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-body text-text-primary font-semibold">
            {status.complete} of {status.total} pages generated
            <span className="ml-3 text-text-muted font-normal">
              {status.approved} of {status.complete} approved
            </span>
          </span>
          <span className="text-xs font-body text-text-muted">
            {isRunning ? 'Generating...' : 'Complete'}
            {status.error > 0 && (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={() => setShowErrors(v => !v)}
                  className="text-error font-semibold hover:underline"
                  title="Show why these pages failed and retry them"
                >
                  {status.error} error{status.error !== 1 ? 's' : ''} {showErrors ? '▲' : '▾'}
                </button>
              </>
            )}
          </span>
        </div>
        <div className="w-full h-2 bg-surface-subtle rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              status.error > 0 && !isRunning ? 'bg-warning' : 'bg-brand-cyan'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {showErrors && status.error > 0 && (
        <div className="border border-error/30 bg-error/5 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-heading font-semibold text-error">
              Failed pages ({status.error})
            </span>
            <button
              type="button"
              onClick={restartGeneration}
              disabled={restarting}
              className="text-xs font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Re-run generation for every failed page at once"
            >
              {restarting ? 'Retrying…' : 'Retry all failed'}
            </button>
          </div>
          {status.pages.filter(p => p.status === 'error').map(page => {
            const retryBusy = pendingActions.has(`regen:${page.id}`)
            return (
              <div
                key={page.id}
                className="text-xs font-body border-t border-error/15 pt-2 first:border-t-0 first:pt-0"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-text-primary flex-1 truncate" title={page.title}>
                    {page.title}
                  </span>
                  <span className="font-mono text-text-muted truncate max-w-[40%]" title={page.url}>
                    {page.url}
                  </span>
                  <button
                    type="button"
                    onClick={() => retryPage(page)}
                    disabled={retryBusy}
                    className="text-brand-cyan hover:text-brand-navy font-heading font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    {retryBusy ? '…' : 'Retry'}
                  </button>
                </div>
                <p className="text-error mt-0.5 font-mono break-words whitespace-pre-wrap">
                  {page.errorMessage || 'No error detail recorded (page failed before error tracking — retry to capture the reason).'}
                </p>
              </div>
            )
          })}
        </div>
      )}

      <div className="max-h-[400px] overflow-y-auto space-y-1">
        {(() => {
          const parentByUrl = new Map(status.pages.map(p => [p.url, p.parent]))
          return status.pages.map(page => {
            const s = STATUS_ICONS[page.status] ?? STATUS_ICONS.pending
            const depth = depthOf(page.url, parentByUrl)
            const wcBadge = page.status === 'complete' ? wordCountBadge(page.wordCountActual, page.wordCountTarget) : null
            const approveBusy = pendingActions.has(`approve:${page.id}`)
            const regenBusy = pendingActions.has(`regen:${page.id}`)
            const flagBusy = pendingActions.has(`flag:${page.id}`)
            return (
              <div
                key={page.id}
                className="rounded hover:bg-surface-subtle transition-colors"
                style={{ paddingLeft: `${0.75 + depth * 1.25}rem`, paddingRight: '0.75rem' }}
              >
                <div className="flex items-center gap-2 py-1.5">
                  <span className={`text-sm ${s.cls}`} title={s.title}>{s.icon}</span>
                  <span className="text-sm font-body text-text-primary flex-1 truncate">{page.title}</span>
                  {wcBadge && (
                    <span
                      className={`text-xs font-mono px-1.5 py-0.5 rounded ${wcBadge.cls}`}
                      title={wcBadge.title}
                    >
                      {wcBadge.label}
                    </span>
                  )}
                  {page.needsClientReview && (
                    <span
                      className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                        page.clientApproved
                          ? 'text-success bg-success/10'
                          : 'text-warning-strong bg-warning/10'
                      }`}
                      title={
                        page.clientApproved
                          ? 'Client has reviewed and approved this page via the client review URL.'
                          : 'This page is flagged for client review. The deliverable cannot be assembled until the client approves it via the review URL.'
                      }
                    >
                      {page.clientApproved ? 'Client ✓' : 'Awaiting client'}
                    </span>
                  )}
                  <span className="text-xs font-mono text-text-muted flex-shrink-0">{page.url}</span>
                  {page.status === 'complete' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPreviewPageId(page.id)}
                        className="text-xs font-body text-text-secondary hover:text-brand-cyan transition-colors"
                        title="Open the rendered + raw view of this page; edit metadata or markdown inline"
                      >
                        View
                      </button>
                      <label
                        className="flex items-center gap-1 text-xs font-body text-text-secondary cursor-pointer"
                        title="Flag this page for client review. Flagged pages appear in the public review URL and gate the deliverable until the client approves."
                      >
                        <input
                          type="checkbox"
                          checked={page.needsClientReview ?? false}
                          disabled={flagBusy}
                          onChange={e => toggleClientReviewFlag(page, e.target.checked)}
                          className="accent-brand-cyan"
                        />
                        Client review
                      </label>
                      <label
                        className="flex items-center gap-1 text-xs font-body text-text-secondary cursor-pointer"
                        title="Admin approval. Required before the deliverable package can be assembled. Resets to false whenever content or the outline is edited."
                      >
                        <input
                          type="checkbox"
                          checked={page.approved ?? false}
                          disabled={approveBusy}
                          onChange={e => toggleApprove(page, e.target.checked)}
                          className="accent-brand-cyan"
                        />
                        Approved
                      </label>
                      <button
                        type="button"
                        onClick={() => regenerate(page)}
                        disabled={regenBusy || page.status !== 'complete'}
                        className="text-xs font-body text-text-secondary hover:text-brand-cyan transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Re-run Claude to generate fresh content for this page. Approval (both admin and client) resets to false on regeneration."
                      >
                        {regenBusy ? '…' : 'Regen'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })
        })()}
      </div>

      {status.error > 0 && !isRunning && (
        <div className="bg-warning/10 border border-warning/30 text-warning-strong text-sm font-body rounded-lg px-4 py-2">
          {status.complete} pages generated · {status.error} failed — deliverables will include an ERRORS.md noting skipped pages.
        </div>
      )}

      {!isRunning && status.complete > 0 && allApproved && (
        <div className="bg-success/10 border border-success/30 text-success text-sm font-body rounded-lg px-4 py-2">
          All pages approved. Proceed to Deliverables to download the content package.
        </div>
      )}

      {!isRunning && status.complete > 0 && !allApproved && (
        <div className="bg-info/10 border border-info/20 text-info text-sm font-body rounded-lg px-4 py-2">
          {!allAdminApproved
            ? <>Review each page above and check &quot;Approved&quot; before assembling the deliverable. {status.complete - status.approved} of {status.complete} still need review.</>
            : <>{status.needsClientReview - status.clientApproved} of {status.needsClientReview} flagged pages still awaiting client approval. Copy the review link above and send it to the client.</>
          }
        </div>
      )}

      {restartError && (
        <div className="bg-error/10 border border-error/20 text-error text-sm font-body rounded-lg px-4 py-2">
          {restartError}
        </div>
      )}

      {/* Stuck-recovery: any time some pages haven't reached a terminal state,
          allow restart. Includes the "running" case because Vercel may have
          killed the pipeline mid-call, leaving rows orphaned in running.
          The pipeline itself skips already-complete rows, so re-running is
          idempotent for the work that's already done. */}
      {status.complete + status.error < status.total && (
        <button
          onClick={restartGeneration}
          disabled={restarting}
          className="bg-brand-cyan text-white font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {restarting ? 'Restarting...' : status.running > 0 ? 'Restart generation (unstick)' : 'Restart generation'}
        </button>
      )}

      {previewPageId && (
        <MarkdownPreviewModal
          contentJobId={contentJobId}
          pageId={previewPageId}
          onClose={() => setPreviewPageId(null)}
          onApprovalChange={() => setPollNonce(n => n + 1)}
        />
      )}
    </div>
  )
}
