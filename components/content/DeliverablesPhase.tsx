'use client'

import { useState } from 'react'

export default function DeliverablesPhase({
  contentJobId,
  pageCount,
}: {
  contentJobId: string
  pageCount: number
}) {
  const [packaging, setPackaging] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [packaged, setPackaged] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [packageInfo, setPackageInfo] = useState<{ pageCount: number; sizeKB: number } | null>(null)

  const assemblePackage = async () => {
    setPackaging(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/package`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to assemble package')
      }
      const data = await res.json()
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

  return (
    <div className="space-y-4">
      <div className="bg-green-50 border border-green-200 text-green-700 text-sm font-body rounded-lg px-4 py-3">
        Content generation complete.
      </div>

      {!packaged ? (
        <div className="space-y-3">
          <p className="text-sm font-body text-text-secondary">
            Ready to assemble the deliverable package: {pageCount} pages, Word document, llms.txt, llms-full.txt, and robots.txt.
          </p>
          <button
            onClick={assemblePackage}
            disabled={packaging}
            className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-6 py-3 rounded-pill transition-all hover:bg-brand-navy-dark disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {packaging ? 'Assembling Package...' : 'Assemble & Download Package'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm font-body text-text-primary">
            <span className="font-semibold">{packageInfo?.pageCount ?? pageCount} pages</span>
            <span className="text-text-muted"> · 1 Word document · 3 support files</span>
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
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-body rounded-lg px-4 py-2">
          {error}
        </div>
      )}
    </div>
  )
}
