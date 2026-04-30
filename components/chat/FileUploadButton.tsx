'use client'
import { useState, useRef } from 'react'

type Props = {
  sessionId: string
  onUploadComplete: (fileName: string, assetId: string) => void
}

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.gif', '.png', '.tif', '.tiff', '.pdf']
const MAX_BYTES = 300 * 1024 * 1024

function detectCategory(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.includes('logo')) return 'logo'
  if (/brand|guide|guideline|style/.test(lower)) return 'brand_guide'
  if (/headshot|portrait|photo/.test(lower)) return 'headshot'
  return 'other'
}

export default function FileUploadButton({ sessionId, onUploadComplete }: Props) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '')
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setError(`File type not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}`)
      return
    }
    if (file.size > MAX_BYTES) {
      setError('File too large. Maximum size is 300MB.')
      return
    }

    setError('')
    setUploading(true)
    setProgress(10)

    try {
      const presignRes = await fetch('/api/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          assetCategory: detectCategory(file.name),
        }),
      })

      const presignData = await presignRes.json() as { signedUrl?: string; storagePath?: string; error?: string }
      if (presignData.error) throw new Error(presignData.error)
      if (!presignData.signedUrl || !presignData.storagePath) throw new Error('Invalid presign response')

      setProgress(30)

      const uploadRes = await fetch(presignData.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!uploadRes.ok) throw new Error('Upload to storage failed')

      setProgress(80)

      const confirmRes = await fetch('/api/upload/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          storagePath: presignData.storagePath,
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          assetCategory: detectCategory(file.name),
        }),
      })

      const confirmData = await confirmRes.json() as { assetId?: string; error?: string }
      if (confirmData.error) throw new Error(confirmData.error)
      if (!confirmData.assetId) throw new Error('No asset ID returned')

      setProgress(100)
      onUploadComplete(file.name, confirmData.assetId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      setError(message)
    } finally {
      setUploading(false)
      setProgress(0)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_EXTENSIONS.join(',')}
        onChange={handleFileSelect}
        disabled={uploading}
        className="hidden"
        id="file-upload-input"
      />
      <label
        htmlFor="file-upload-input"
        className={[
          'inline-flex items-center gap-2 px-4 py-2.5 rounded-pill text-sm font-heading font-semibold transition-all cursor-pointer',
          uploading
            ? 'bg-surface-card text-text-secondary border border-border-default cursor-not-allowed opacity-60'
            : 'bg-surface-card text-brand-navy border border-border-default hover:border-brand-cyan hover:text-brand-cyan',
        ].join(' ')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
        {uploading ? `Uploading… ${progress}%` : 'Attach file'}
      </label>
      {error && (
        <p className="text-red-600 text-xs font-body">{error}</p>
      )}
    </div>
  )
}
