'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const inputClass =
  'w-full rounded-lg border border-border-default bg-surface-card px-4 py-2.5 font-body text-sm text-text-primary focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/20'
const labelClass = 'block font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary'

export function NewAuditForm() {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [siteName, setSiteName] = useState('')
  const [maxPages, setMaxPages] = useState(50)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const createRes = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          siteName: siteName || undefined,
          maxPages,
        }),
      })
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to create audit')
      }
      const { id } = await createRes.json()

      const runRes = await fetch(`/api/audits/${id}/run`, { method: 'POST' })
      if (!runRes.ok) throw new Error('Audit created but failed to start')

      router.push(`/admin/audits/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label htmlFor="url" className={labelClass}>
          Website URL
        </label>
        <input
          id="url"
          type="text"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="example.com"
          className={`mt-1.5 ${inputClass}`}
        />
      </div>

      <div>
        <label htmlFor="siteName" className={labelClass}>
          Site name <span className="font-normal normal-case text-text-muted">(optional)</span>
        </label>
        <input
          id="siteName"
          type="text"
          value={siteName}
          onChange={(e) => setSiteName(e.target.value)}
          placeholder="Acme Accounting"
          className={`mt-1.5 ${inputClass}`}
        />
      </div>

      <div>
        <label htmlFor="maxPages" className={labelClass}>
          Max pages to crawl
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

      {error && (
        <p className="rounded-lg bg-error/10 px-4 py-2 font-body text-sm text-error">{error}</p>
      )}

      <button
        type="submit"
        disabled={submitting || !url.trim()}
        className="rounded-pill bg-brand-cyan px-3.5 py-1.5 font-heading text-xs font-semibold text-text-inverse shadow-cyan-base transition-all hover:-translate-y-px hover:bg-brand-cyan-dark hover:shadow-cyan-glow disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Starting audit…' : 'Run audit'}
      </button>
    </form>
  )
}
