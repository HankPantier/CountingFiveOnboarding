'use client'

import { useCallback, useEffect, useState } from 'react'

type DiscoveredArticle = {
  url: string
  title: string
  metaDescription: string
  wordCount: number
  hasImages: boolean
  isSyndicatedHint: boolean
}

// Shown at outline proofing (Phase 4), below the library panel. Lists the
// client's OWN existing articles (discovered in the audit crawl) that can be
// brought into the new site AS-IS — body kept verbatim, images re-hosted, links
// added. Selections are recorded now; the import runs at Deliverables (phase 6),
// when the repo exists. The operator must make an explicit choice before content
// generation can start; a session with no discovered articles auto-acknowledges.
export default function ArticleImportPanel({
  contentJobId,
  onAcknowledgedChange,
}: {
  contentJobId: string
  onAcknowledgedChange: (acknowledged: boolean) => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [articles, setArticles] = useState<DiscoveredArticle[]>([])
  const [syndication, setSyndication] = useState<string>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/imports`)
      if (!res.ok) throw new Error('Failed to load existing articles')
      const data = await res.json()
      const found: DiscoveredArticle[] = data.articles ?? []
      setArticles(found)
      setSyndication(typeof data.syndicationAssessment === 'string' ? data.syndicationAssessment : '')
      const preselected: string[] = data.selectedUrls ?? []
      if (preselected.length) setSelected(new Set(preselected))
      // Nothing to confirm (no blog / no audit), or a choice was already saved →
      // acknowledged so the phase gate never deadlocks.
      if (found.length === 0 || preselected.length) setAcknowledged(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load existing articles')
    } finally {
      setLoading(false)
    }
  }, [contentJobId])

  // Inner async wrapper (not a direct load() call) so the effect never appears
  // to setState synchronously — updates only happen after the fetch awaits.
  useEffect(() => {
    const run = async () => { await load() }
    void run()
  }, [load])

  useEffect(() => {
    onAcknowledgedChange(acknowledged)
  }, [acknowledged, onAcknowledgedChange])

  const toggle = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
    setAcknowledged(false)
  }

  const selectAll = () => {
    setSelected(new Set(articles.map((a) => a.url)))
    setAcknowledged(false)
  }

  const clearAll = () => {
    setSelected(new Set())
    setAcknowledged(false)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [...selected] }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Failed to save selections')
      }
      setAcknowledged(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save selections')
    } finally {
      setSaving(false)
    }
  }

  // No importable articles: render a quiet note. Acknowledged is already set so
  // this never blocks the phase advance.
  if (!loading && articles.length === 0) {
    return (
      <div className="bg-surface-card border border-border-default rounded-xl p-4">
        <p className="text-sm font-heading font-semibold text-brand-navy">Bring over existing articles</p>
        <p className="text-xs font-body text-text-muted mt-0.5">
          No existing articles were found on the current site to import.
        </p>
      </div>
    )
  }

  const selectedCount = selected.size

  return (
    <div className="bg-surface-card border border-border-default rounded-xl p-4 space-y-3">
      <div>
        <p className="text-sm font-heading font-semibold text-brand-navy">Bring over existing articles</p>
        <p className="text-xs font-body text-text-muted">
          Import the client&apos;s own existing posts as-is — original wording kept, images re-hosted, internal links added. Runs during Deliverables.
        </p>
      </div>

      {syndication && (
        <div className="bg-warning/10 border border-warning/20 text-warning-strong text-xs font-body rounded-lg px-3 py-2">
          <span className="font-semibold">Heads up on originality: </span>
          {syndication}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-text-muted font-body py-2">Scanning the audit for existing articles…</p>
      ) : (
        <>
          <div className="flex items-center gap-3 text-xs font-body">
            <span className="text-text-primary font-semibold">{selectedCount} selected</span>
            <button type="button" onClick={selectAll} className="text-brand-cyan hover:underline">
              Select all
            </button>
            <button type="button" onClick={clearAll} className="text-text-muted hover:underline">
              Clear
            </button>
          </div>
          <div className="border border-border-default rounded-card max-h-64 overflow-y-auto divide-y divide-border-default">
            {articles.map((a) => (
              <label key={a.url} className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-surface-subtle">
                <input
                  type="checkbox"
                  checked={selected.has(a.url)}
                  onChange={() => toggle(a.url)}
                  className="mt-0.5 accent-brand-cyan"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-body text-text-primary truncate">{a.title}</span>
                  <span className="block text-xs text-text-muted truncate">{a.url}</span>
                </span>
                <span className="ml-auto shrink-0 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-muted font-heading">
                  {a.isSyndicatedHint && <span className="text-warning-strong">syndicated?</span>}
                  {a.hasImages && <span>images</span>}
                  <span>{a.wordCount}w</span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      {error && (
        <div className="bg-error/10 border border-error/20 text-error text-sm font-body rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || loading}
          className="border border-brand-cyan text-brand-navy font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan hover:text-text-inverse disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : acknowledged ? 'Saved ✓' : selectedCount > 0 ? `Import ${selectedCount} & continue` : 'Continue without importing'}
        </button>
        {!acknowledged && !loading && (
          <span className="text-xs font-body text-text-muted">Save your choice to enable content generation.</span>
        )}
      </div>
    </div>
  )
}
