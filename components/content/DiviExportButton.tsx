'use client'

import { useState } from 'react'

// Downloads the Divi/WordPress export bundle (zip) for a content job. Part of
// the throwaway Divi export bridge (see lib/content/divi/README.md). The route
// streams the zip directly, so we read it as a blob and trigger a save.
export default function DiviExportButton({ contentJobId }: { contentJobId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/export-divi`)
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'Export failed')
      }
      const blob = await res.blob()
      const disposition = res.headers.get('content-disposition') ?? ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match?.[1] ?? 'divi-export.zip'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={download}
        disabled={busy}
        className="border border-brand-cyan text-brand-cyan font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-colors hover:bg-brand-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Building…' : 'Export to Divi'}
      </button>
      {error && <p className="text-xs font-body text-error max-w-[220px] text-right">{error}</p>}
    </div>
  )
}
