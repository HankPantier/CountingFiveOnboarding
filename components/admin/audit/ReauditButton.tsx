'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Runs a fresh audit of the same site so its score can be compared to the
// original (the audit list/report show the per-domain delta). A NEW audit is
// created — the source audit stays as the "before" baseline. Meant to be run
// once the new content is actually live, not the moment it's delivered.
export function ReauditButton({ url }: { url: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!confirm('Start a fresh audit of the live site? This runs a new crawl and opens its progress page.')) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const createRes = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!createRes.ok) throw new Error('Could not start the audit')
      const { id } = await createRes.json()
      const runRes = await fetch(`/api/audits/${id}/run`, { method: 'POST' })
      if (!runRes.ok) throw new Error('Audit created but failed to start')
      router.push(`/admin/audits/${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the audit')
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 mb-4">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-pill border border-brand-navy px-3.5 py-1.5 font-heading text-xs font-semibold text-brand-navy transition-colors hover:bg-brand-navy hover:text-text-inverse disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Starting re-audit…' : 'Re-audit live site →'}
      </button>
      {!busy && (
        <p className="mt-1.5 font-body text-xs text-text-secondary">
          Run once the new site is live to measure the lift vs. the original audit.
        </p>
      )}
      {error && (
        <p className="mt-2 rounded-lg bg-error/10 px-3 py-1.5 font-body text-xs text-error">{error}</p>
      )}
    </div>
  )
}
