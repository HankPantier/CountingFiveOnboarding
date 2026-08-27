'use client'

import { useCallback, useEffect, useState } from 'react'

type Batch = {
  id: string
  title: string
  angle: string | null
  content_type: string
  industry: string
  created_at: string
}

type IndustryOption = { value: string; label: string }

// Shown at outline proofing (Phase 4). Asks the operator whether to include any
// previously-produced bulk/library content in this new site. Selections are
// recorded now; each is re-drafted uniquely against this client's MBP at
// Deliverables (phase 6), when the site's repo exists. The operator must make an
// explicit choice (select + save, or save none) before content generation can start.
export default function LibraryContentPanel({
  contentJobId,
  onAcknowledgedChange,
}: {
  contentJobId: string
  onAcknowledgedChange: (acknowledged: boolean) => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [batches, setBatches] = useState<Batch[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [industries, setIndustries] = useState<IndustryOption[]>([])
  const [filter, setFilter] = useState<string>('') // '' until first load resolves the inferred default
  const [saving, setSaving] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  const load = useCallback(
    async (industryFilter: string | null) => {
      // Note: no synchronous setState here — the initial call runs from an effect,
      // and cascading renders are avoided by awaiting the fetch before any update.
      // The filter-change handler owns the loading/error reset (it's a user event).
      try {
        const qs = industryFilter ? `?industry=${encodeURIComponent(industryFilter)}` : ''
        const res = await fetch(`/api/content-jobs/${contentJobId}/library${qs}`)
        if (!res.ok) throw new Error('Failed to load library content')
        const data = await res.json()
        setBatches(data.batches ?? [])
        setIndustries(data.industries ?? [])
        setFilter(data.industry ?? data.inferredIndustry ?? 'all')
        // Pre-check anything already saved for this job; an existing selection
        // means the operator has already made (and recorded) a choice.
        const preselected: string[] = data.selectedBatchIds ?? []
        if (preselected.length) {
          setSelected((prev) => new Set([...prev, ...preselected]))
          setAcknowledged(true)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load library content')
      } finally {
        setLoading(false)
      }
    },
    [contentJobId]
  )

  // Initial load resolves the client's inferred industry as the default filter.
  useEffect(() => {
    const run = async () => { await load(null) }
    void run()
  }, [load])

  useEffect(() => {
    onAcknowledgedChange(acknowledged)
  }, [acknowledged, onAcknowledgedChange])

  const changeFilter = (next: string) => {
    setFilter(next)
    setLoading(true)
    setError(null)
    load(next)
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    // A change after saving means the operator must re-save to record it.
    setAcknowledged(false)
  }

  const selectAllVisible = () => {
    setSelected((prev) => new Set([...prev, ...batches.map((b) => b.id)]))
    setAcknowledged(false)
  }

  const clearVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const b of batches) next.delete(b.id)
      return next
    })
    setAcknowledged(false)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchIds: [...selected] }),
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

  const selectedCount = selected.size

  return (
    <div className="bg-surface-card border border-border-default rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-heading font-semibold text-brand-navy">Include existing content</p>
          <p className="text-xs font-body text-text-muted">
            Add previously-produced articles to this site. Each is re-drafted uniquely for this client and finishes during Deliverables.
          </p>
        </div>
        {industries.length > 0 && (
          <select
            value={filter}
            onChange={(e) => changeFilter(e.target.value)}
            className="shrink-0 rounded-pill border border-border-default bg-surface-card px-3 py-1 text-xs font-heading font-semibold text-brand-navy focus:outline-none focus:border-brand-cyan"
          >
            {industries.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value="all">All industries</option>
          </select>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-text-muted font-body py-2">Loading library…</p>
      ) : batches.length === 0 ? (
        <p className="text-sm text-text-muted font-body py-2">
          No library content for this industry yet. Save to continue without adding any.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3 text-xs font-body">
            <span className="text-text-primary font-semibold">{selectedCount} selected</span>
            <button type="button" onClick={selectAllVisible} className="text-brand-cyan hover:underline">
              Select all
            </button>
            <button type="button" onClick={clearVisible} className="text-text-muted hover:underline">
              Clear
            </button>
          </div>
          <div className="border border-border-default rounded-card max-h-64 overflow-y-auto divide-y divide-border-default">
            {batches.map((b) => (
              <label key={b.id} className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-surface-subtle">
                <input
                  type="checkbox"
                  checked={selected.has(b.id)}
                  onChange={() => toggle(b.id)}
                  className="mt-0.5 accent-brand-cyan"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-body text-text-primary truncate">{b.title}</span>
                  {b.angle && <span className="block text-xs text-text-muted truncate">{b.angle}</span>}
                </span>
                <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-text-muted font-heading">
                  {b.content_type}
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
          {saving ? 'Saving…' : acknowledged ? 'Saved ✓' : selectedCount > 0 ? `Include ${selectedCount} & continue` : 'Continue without extra content'}
        </button>
        {!acknowledged && !loading && (
          <span className="text-xs font-body text-text-muted">Save your choice to enable content generation.</span>
        )}
      </div>
    </div>
  )
}
