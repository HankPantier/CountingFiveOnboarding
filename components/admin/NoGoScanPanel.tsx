'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { NoGoScanResponse } from '@/types/no-go-phrases'

export default function NoGoScanPanel() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<NoGoScanResponse | null>(null)

  async function scan() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/no-go-phrases/scan')
      const data = (await res.json()) as NoGoScanResponse & { error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Scan failed')
        return
      }
      setResult(data)
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-10 rounded-xl border border-border-default bg-surface-card p-6 shadow-subtle">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-lg font-bold text-brand-navy">Scan existing content</h2>
          <p className="mt-1 font-body text-sm text-text-secondary">
            Check every already-generated page for these phrases. Report only — fix any hits in the
            page editor.
          </p>
        </div>
        <button
          onClick={scan}
          disabled={busy}
          className="rounded-pill bg-brand-navy px-4 py-2 font-heading text-xs font-semibold text-text-inverse transition-all hover:bg-brand-navy-dark disabled:opacity-50"
        >
          {busy ? 'Scanning…' : 'Scan now'}
        </button>
      </div>

      {error && <p className="mt-4 rounded-card bg-error/10 px-3 py-2 font-body text-sm text-error">{error}</p>}

      {result && (
        <div className="mt-4">
          {result.hits.length === 0 ? (
            <p className="rounded-card bg-success/10 px-3 py-2 font-body text-sm text-success">
              Clean — scanned {result.scanned} page{result.scanned === 1 ? '' : 's'}, no no-go phrases found.
            </p>
          ) : (
            <>
              <p className="mb-3 font-body text-sm text-text-secondary">
                {result.hits.length} page{result.hits.length === 1 ? '' : 's'} of {result.scanned} contain a no-go phrase:
              </p>
              <ul className="space-y-2">
                {result.hits.map((h, i) => (
                  <li key={`${h.sessionId}-${h.pageUrl}-${i}`} className="rounded-card border border-border-default px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-heading text-sm font-semibold text-text-primary">{h.pageTitle}</div>
                        <div className="truncate font-mono text-[11.5px] text-text-muted">{h.pageUrl}</div>
                        <div className="mt-1 font-body text-xs text-error">
                          {h.matchedPhrases.map((p) => `“${p}”`).join(', ')}
                        </div>
                      </div>
                      <Link
                        href={`/admin/content/${h.sessionId}/edit`}
                        className="shrink-0 rounded-pill border border-border-default px-3 py-1.5 font-heading text-xs font-semibold text-text-secondary transition-all hover:border-brand-cyan hover:text-brand-cyan"
                      >
                        Open editor
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}
