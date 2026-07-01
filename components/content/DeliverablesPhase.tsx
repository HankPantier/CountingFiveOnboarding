'use client'

import { useEffect, useState } from 'react'
import NavCurationPhase from './NavCurationPhase'
import type { NavJson } from '@/types/nav-json'

type SitemapEntry = { url: string; title: string; parent?: string; status?: string }

type ApprovalSnapshot = {
  total: number
  complete: number
  error: number
  approved: number
  unapproved: Array<{ id: string; title: string; url: string }>
}

type Unapproved = { id?: string; page_title?: string; page_url?: string }

export default function DeliverablesPhase({
  contentJobId,
  pageCount,
  initialNavConfig,
  confirmedSitemap,
}: {
  contentJobId: string
  pageCount: number
  initialNavConfig: NavJson | null
  confirmedSitemap: SitemapEntry[]
}) {
  const [packaging, setPackaging] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [packaged, setPackaged] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unapprovedFromGate, setUnapprovedFromGate] = useState<Unapproved[] | null>(null)
  const [packageInfo, setPackageInfo] = useState<{ pageCount: number; sizeKB: number } | null>(null)
  const [deployState, setDeployState] = useState<'idle' | 'deploying' | 'deployed' | 'unknown'>('idle')
  const [linkWarnings, setLinkWarnings] = useState<string[]>([])
  const [redirectIssues, setRedirectIssues] = useState<Array<{ severity: string; oldUrl: string; reason: string }>>([])
  const [approval, setApproval] = useState<ApprovalSnapshot | null>(null)

  // Poll the approval state so the assemble button knows whether the gate
  // would reject. Stops polling once everything's approved.
  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(`/api/content-jobs/${contentJobId}/generation-status`)
        if (cancelled || !res.ok) return
        const data = await res.json()
        const unapproved = (data.pages ?? [])
          .filter((p: { status: string; approved: boolean }) => p.status === 'complete' && !p.approved)
          .map((p: { id: string; title: string; url: string }) => ({ id: p.id, title: p.title, url: p.url }))
        const snap: ApprovalSnapshot = {
          total: data.total ?? 0,
          complete: data.complete ?? 0,
          error: data.error ?? 0,
          approved: data.approved ?? 0,
          unapproved,
        }
        setApproval(snap)
        if (snap.complete > 0 && snap.complete === snap.approved) {
          clearInterval(intervalId)
        }
      } catch {
        // retry on next tick
      }
    }

    const intervalId = setInterval(poll, 5000)
    poll()
    return () => { cancelled = true; clearInterval(intervalId) }
  }, [contentJobId])

  // Poll the linked repo's draft HEAD until a new "Deploy packaged content"
  // commit appears (the background push landed) or we give up. `baselineSha` is
  // the pre-push HEAD captured before assembly, so a fresh deploy commit is a
  // sha change — no clock comparison needed.
  const trackDeploy = async (baselineSha: string | null) => {
    setDeployState('deploying')
    const MAX_POLLS = 40 // ~3.3 min at 5s
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, 5000))
      try {
        const res = await fetch(`/api/content-jobs/${contentJobId}/deploy-status`)
        if (!res.ok) continue
        const data = await res.json()
        if (data.repo == null) { setDeployState('idle'); return }
        if (data.reachable && data.isDeployCommit && data.lastCommitSha && data.lastCommitSha !== baselineSha) {
          setDeployState('deployed')
          return
        }
      } catch {
        // keep polling
      }
    }
    setDeployState('unknown')
  }

  const assemblePackage = async () => {
    setPackaging(true)
    setError(null)
    setUnapprovedFromGate(null)
    setDeployState('idle')
    // Capture the repo's current HEAD before the push runs so trackDeploy can
    // detect the new deploy commit.
    let baselineSha: string | null = null
    try {
      const b = await fetch(`/api/content-jobs/${contentJobId}/deploy-status`)
      if (b.ok) baselineSha = (await b.json()).lastCommitSha ?? null
    } catch {
      // baseline is best-effort
    }
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/package`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (Array.isArray(data?.unapproved)) setUnapprovedFromGate(data.unapproved)
        throw new Error(data?.error ?? 'Failed to assemble package')
      }
      setPackageInfo({ pageCount: data.pageCount, sizeKB: data.sizeKB })
      setLinkWarnings(Array.isArray(data.linkWarnings) ? data.linkWarnings : [])
      setRedirectIssues(Array.isArray(data.redirectIssues) ? data.redirectIssues : [])
      setPackaged(true)
      if (data.pushScheduled) void trackDeploy(baselineSha)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assemble')
    } finally {
      setPackaging(false)
    }
  }

  const downloadPackage = async () => {
    setDownloading(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/download`)
      if (!res.ok) throw new Error('Failed to get download URL')
      const data = await res.json()
      window.open(data.url, '_blank')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  const allApproved = approval ? approval.complete > 0 && approval.complete === approval.approved : false
  const hasUnapproved = approval ? approval.complete - approval.approved > 0 : false
  // "Done" means every page has reached a terminal state, not that all succeeded.
  // Failed pages are skipped by the assembler and listed in ERRORS.md, so they
  // must not block assembly forever (they otherwise stall the whole deliverable).
  const generationDone = approval !== null && approval.total > 0 && approval.complete + approval.error >= approval.total

  return (
    <div className="space-y-6">
      {/* Nav Curation */}
      <section className="border border-border-default rounded-lg p-4 space-y-3">
        <h3 className="text-lg font-semibold font-heading">Curate Navigation</h3>
        <NavCurationPhase
          contentJobId={contentJobId}
          initialNavConfig={initialNavConfig}
          confirmedSitemap={confirmedSitemap}
        />
      </section>

      {/* Package Assembly */}
      <div className="space-y-4">
      {generationDone ? (
        approval && approval.error > 0 ? (
          <div className="bg-warning/10 border border-warning/30 text-warning-strong text-sm font-body rounded-lg px-4 py-3">
            Content generation finished — {approval.complete} of {approval.total} pages. {approval.error} failed and will be skipped (listed in ERRORS.md). Retry them in the Content Generation step above if you want them included.
          </div>
        ) : (
          <div className="bg-success/10 border border-success/30 text-success text-sm font-body rounded-lg px-4 py-3">
            Content generation complete.
          </div>
        )
      ) : (
        <div className="bg-info/10 border border-info/20 text-info text-sm font-body rounded-lg px-4 py-3">
          {approval
            ? `Waiting for content generation — ${approval.complete} of ${approval.total} pages ready${approval.error > 0 ? ` (${approval.error} failed)` : ''}.`
            : 'Loading generation status…'}
        </div>
      )}

      {!packaged ? (
        <div className="space-y-3">
          <p className="text-sm font-body text-text-secondary">
            Ready to assemble the deliverable package: {pageCount} pages, Word document, brand.md, llms.txt, llms-full.txt, robots.txt, sitemap.xml, redirects.csv, and an og-images README.
          </p>

          {approval && generationDone && hasUnapproved && (
            <div className="bg-warning/10 border border-warning/30 text-warning-strong text-sm font-body rounded-lg px-4 py-2 space-y-1">
              <div>
                {approval.complete - approval.approved} of {approval.complete} pages still need approval before packaging.
              </div>
              <div className="text-xs font-mono text-warning-strong">
                Approve them in the Content Generation step above.
              </div>
            </div>
          )}

          <button
            onClick={assemblePackage}
            disabled={packaging || hasUnapproved || !generationDone}
            className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {packaging
              ? 'Assembling Package...'
              : !generationDone
                ? 'Assemble Package (waiting on generation)'
                : allApproved
                  ? 'Assemble & Download Package'
                  : 'Assemble Package (pending approvals)'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm font-body text-text-primary">
            <span className="font-semibold">{packageInfo?.pageCount ?? pageCount} pages</span>
            <span className="text-text-muted"> · 1 Word document · brand.md · llms.txt · llms-full.txt · robots.txt · sitemap.xml · redirects.csv · og-images/README.md</span>
            {packageInfo?.sizeKB && (
              <span className="text-text-muted"> · {packageInfo.sizeKB} KB</span>
            )}
          </div>

          {deployState === 'deploying' && (
            <div className="bg-info/10 border border-info/20 text-info text-sm font-body rounded-lg px-4 py-2">
              Deploying content to the site repo&rsquo;s <span className="font-mono">draft</span> branch in the background… This can take a minute for image-heavy sites. The download below is ready now.
            </div>
          )}
          {deployState === 'deployed' && (
            <div className="bg-success/10 border border-success/30 text-success text-sm font-body rounded-lg px-4 py-2">
              Deployed to the site repo&rsquo;s <span className="font-mono">draft</span> branch. Review in the content editor, then <span className="font-semibold">Publish to live</span> when ready.
            </div>
          )}
          {deployState === 'unknown' && (
            <div className="bg-warning/10 border border-warning/20 text-warning-strong text-sm font-body rounded-lg px-4 py-2">
              Couldn&rsquo;t confirm the repo deploy from here — it may still be finishing. Check the content editor for the latest <span className="font-mono">draft</span> commit; the download below works regardless.
            </div>
          )}

          {redirectIssues.length > 0 && (
            <div className="bg-warning/10 border border-warning/20 text-warning-strong text-sm font-body rounded-lg px-4 py-2 space-y-1">
              <div className="font-heading font-semibold">
                {redirectIssues.length} redirect map issue(s) — fix in redirects.csv before launch:
              </div>
              <ul className="text-xs font-mono space-y-0.5">
                {redirectIssues.map((i) => (
                  <li key={`${i.oldUrl}-${i.reason}`}>[{i.severity}] {i.oldUrl}: {i.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {linkWarnings.length > 0 && (
            <div className="bg-warning/10 border border-warning/20 text-warning-strong text-sm font-body rounded-lg px-4 py-2 space-y-1">
              <div className="font-heading font-semibold">
                {linkWarnings.length} internal link(s) point outside the confirmed sitemap:
              </div>
              <ul className="text-xs font-mono space-y-0.5">
                {linkWarnings.slice(0, 10).map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {linkWarnings.length > 10 && <li>…and {linkWarnings.length - 10} more</li>}
              </ul>
              <div className="text-xs">Fix them in the editor — the package still shipped.</div>
            </div>
          )}

          <button
            onClick={downloadPackage}
            disabled={downloading}
            className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloading ? 'Preparing...' : 'Download Package'}
          </button>
        </div>
      )}

      {error && (
        <div className="bg-error/10 border border-error/20 text-error text-sm font-body rounded-lg px-4 py-2 space-y-1">
          <div>{error}</div>
          {unapprovedFromGate && unapprovedFromGate.length > 0 && (
            <ul className="text-xs font-mono space-y-0.5">
              {unapprovedFromGate.map((p, i) => (
                <li key={p.id ?? i}>
                  • {p.page_title ?? p.page_url ?? 'unknown page'}{p.page_url ? ` (${p.page_url})` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
