'use client'

import { useState } from 'react'

const BTN =
  'bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed'

// Shared deliverable-download controls. Used both inside Phase 6 (right after
// assembly) and in the persistent bar at the top of the content page, so the
// signed-URL fetch lives in one place.
export default function PackageDownloadBar({
  contentJobId,
  showZip = true,
  showPlain = true,
}: {
  contentJobId: string
  showZip?: boolean
  showPlain?: boolean
}) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = async (format: 'zip' | 'txt' | 'docx') => {
    setDownloading(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/download?format=${format}`)
      if (!res.ok) throw new Error('Failed to get download URL')
      const data = await res.json()
      window.open(data.url, '_blank')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {showZip && (
          <button onClick={() => download('zip')} disabled={downloading} className={BTN}>
            {downloading ? 'Preparing...' : 'Download Package'}
          </button>
        )}
        {showPlain && (
          <>
            <button onClick={() => download('txt')} disabled={downloading} className={BTN}>
              Plain text (.txt)
            </button>
            <button onClick={() => download('docx')} disabled={downloading} className={BTN}>
              Unstyled Word (.docx)
            </button>
          </>
        )}
      </div>
      {showPlain && (
        <p className="text-xs font-body text-text-muted">
          The plain files strip all formatting so page content pastes cleanly into any CMS or editor.
        </p>
      )}
      {error && <p className="text-xs font-body text-error">{error}</p>}
    </div>
  )
}
