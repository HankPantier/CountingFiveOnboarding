'use client'

import { useEffect, useState } from 'react'
import NavCurationPhase from './NavCurationPhase'
import type { NavJson } from '@/types/nav-json'

type SitemapEntry = { url: string; title: string; parent?: string; status?: string }

type ApprovalSnapshot = {
  total: number
  complete: number
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
  const [approval, setApproval] = useState<ApprovalSnapshot | null>(null)

  // Poll the approval state so the assemble button knows whether the gate
  // would reject. Stops polling once everything's approved.
  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval>

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

    poll()
    intervalId = setInterval(poll, 5000)
    return () => { cancelled = true; clearInterval(intervalId) }
  }, [contentJobId])

  const assemblePackage = async () => {
    setPackaging(true)
    setError(null)
    setUnapprovedFromGate(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/package`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (Array.isArray(data?.unapproved)) setUnapprovedFromGate(data.unapproved)
        throw new Error(data?.error ?? 'Failed to assemble package')
      }
      setPackageInfo({ pageCount: data.pageCount, sizeKB: data.sizeKB })
      setPackaged(true)
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
  const generationDone = approval !== null && approval.total > 0 && approval.complete >= approval.total

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
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm font-body rounded-lg px-4 py-3">
          Content generation complete.
        </div>
      ) : (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-sm font-body rounded-lg px-4 py-3">
          {approval
            ? `Waiting for content generation — ${approval.complete} of ${approval.total} pages ready.`
            : 'Loading generation status…'}
        </div>
      )}

      {!packaged ? (
        <div className="space-y-3">
          <p className="text-sm font-body text-text-secondary">
            Ready to assemble the deliverable package: {pageCount} pages, Word document, brand.md, llms.txt, llms-full.txt, robots.txt, sitemap.xml, redirects.csv, and an og-images README.
          </p>

          {approval && generationDone && hasUnapproved && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm font-body rounded-lg px-4 py-2 space-y-1">
              <div>
                {approval.complete - approval.approved} of {approval.complete} pages still need approval before packaging.
              </div>
              <div className="text-xs font-mono text-amber-900">
                Approve them in the Content Generation step above.
              </div>
            </div>
          )}

          <button
            onClick={assemblePackage}
            disabled={packaging || hasUnapproved || !generationDone}
            className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-6 py-3 rounded-pill transition-all hover:bg-brand-navy-dark disabled:opacity-50 disabled:cursor-not-allowed"
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

          <button
            onClick={downloadPackage}
            disabled={downloading}
            className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-6 py-3 rounded-pill transition-all hover:bg-brand-navy-dark disabled:opacity-50 disabled:cursor-not-allowed"
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
