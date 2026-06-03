'use client'

import { useRef, useState } from 'react'
import AssetThumb from './AssetThumb'
import { replaceAsset } from '@/lib/editor/asset-client'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

// Thumbnail + "Replace" affordance for a single repo image. Replace-in-place:
// the filename is preserved so every markdown/frontmatter reference to it stays
// valid — only the bytes on the draft branch change.
export default function ImageReplaceControl({
  sessionId,
  assetPath,
  alt = '',
  expectedSha,
  onReplaced,
}: {
  sessionId: string
  assetPath: string
  alt?: string
  expectedSha?: string
  onReplaced?: (blobSha: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const { blobSha } = await replaceAsset(sessionId, file, assetPath, expectedSha)
      setVersion((v) => v + 1)
      onReplaced?.(blobSha)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Replace failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <AssetThumb
        sessionId={sessionId}
        assetPath={assetPath}
        version={version}
        alt={alt}
        className="w-20 h-20 rounded-card border border-border-default shrink-0"
      />
      <div className="min-w-0">
        <div className="font-mono text-xs text-text-secondary truncate">
          {assetPath.split('/').pop()}
        </div>
        {alt && <div className="text-[11px] font-body text-text-muted truncate">{alt}</div>}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={(e) => void onPick(e)}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-1 bg-brand-cyan disabled:bg-surface-subtle disabled:text-text-muted text-text-inverse font-heading font-semibold text-[11px] px-3 py-1 rounded-pill transition-all hover:bg-brand-navy-dark disabled:cursor-not-allowed"
        >
          {busy ? 'Uploading…' : 'Replace'}
        </button>
        {error && <div className="mt-1 text-[11px] font-body text-error">{error}</div>}
      </div>
    </div>
  )
}
