'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

const MAX_BATCH_URLS = 25

const inputClass =
  'w-full rounded-lg border border-border-default bg-surface-card px-4 py-2.5 font-body text-sm text-text-primary focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/20'
const labelClass = 'block font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary'

// Count non-blank lines client-side for live feedback. The server does the real
// normalization, dedupe, and validation via parseBatchUrls.
function countLines(text: string): number {
  return text.split(/\r?\n/).filter((l) => l.trim()).length
}

export function NewBatchAuditForm() {
  const router = useRouter()
  const [urls, setUrls] = useState('')
  const [label, setLabel] = useState('')
  const [maxPages, setMaxPages] = useState(80)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lineCount = useMemo(() => countLines(urls), [urls])
  const overLimit = lineCount > MAX_BATCH_URLS

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/audit-batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: urls, label: label || undefined, maxPages }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to create batch')
      }
      const { id } = await res.json()
      router.push(`/admin/audits/batch/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label htmlFor="urls" className={labelClass}>
          Website URLs <span className="font-normal normal-case text-text-muted">(one per line)</span>
        </label>
        <textarea
          id="urls"
          required
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          rows={10}
          placeholder={'example.com\nacme-accounting.com\nanotherfirm.ca'}
          className={`mt-1.5 font-mono ${inputClass}`}
        />
        <p className={`mt-1.5 font-body text-xs ${overLimit ? 'text-error' : 'text-text-muted'}`}>
          {lineCount} URL{lineCount === 1 ? '' : 's'}
          {overLimit ? ` — ${lineCount - MAX_BATCH_URLS} over the limit of ${MAX_BATCH_URLS}` : ` · limit ${MAX_BATCH_URLS}`}
        </p>
      </div>

      <div>
        <label htmlFor="label" className={labelClass}>
          Batch label <span className="font-normal normal-case text-text-muted">(optional)</span>
        </label>
        <input
          id="label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Q3 prospect sweep"
          className={`mt-1.5 ${inputClass}`}
        />
      </div>

      <div>
        <label htmlFor="maxPages" className={labelClass}>
          Max pages to crawl (per site)
        </label>
        <input
          id="maxPages"
          type="number"
          min={1}
          max={250}
          value={maxPages}
          onChange={(e) => setMaxPages(Math.max(1, Math.min(250, Number(e.target.value) || 50)))}
          className={`mt-1.5 ${inputClass}`}
        />
      </div>

      <p className="rounded-lg bg-info/10 px-4 py-2 font-body text-xs text-text-secondary">
        Audits run one at a time in the background — you can leave this page. Larger batches take a
        while (roughly a minute or two per site).
      </p>

      {error && (
        <p className="rounded-lg bg-error/10 px-4 py-2 font-body text-sm text-error">{error}</p>
      )}

      <button
        type="submit"
        disabled={submitting || lineCount === 0 || overLimit}
        className="rounded-pill bg-brand-cyan px-3.5 py-1.5 font-heading text-xs font-semibold text-text-inverse shadow-cyan-base transition-all hover:-translate-y-px hover:bg-brand-cyan-dark hover:shadow-cyan-glow disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Queuing…' : `Queue ${lineCount || ''} audit${lineCount === 1 ? '' : 's'}`.trim()}
      </button>
    </form>
  )
}
