'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import AssetThumb from './AssetThumb'
import {
  type AssetEntry,
  createAsset,
  deleteAsset,
  listAssets,
  replaceAsset,
} from '@/lib/editor/asset-client'
import { ASSET_ROOT } from '@/lib/editor/page-images'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

function humanSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Lowercase, hyphenate, and strip anything outside [a-z0-9._-] so an uploaded
// filename is safe to reference from markdown and survives safeAssetPath.
function slugFilename(name: string): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot + 1) : ''
  const cleanStem = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const cleanExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '')
  return cleanExt ? `${cleanStem || 'image'}.${cleanExt}` : cleanStem || 'image'
}

export default function MediaLibrary({
  sessionId,
  onChanged,
}: {
  sessionId: string
  onChanged?: () => void
}) {
  const [assets, setAssets] = useState<AssetEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [versions, setVersions] = useState<Record<string, number>>({})
  const uploadRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setAssets(await listAssets(sessionId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assets')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const bump = (path: string) => setVersions((v) => ({ ...v, [path]: (v[path] ?? 0) + 1 }))

  const onUploadNew = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      await createAsset(sessionId, file, ASSET_ROOT + slugFilename(file.name))
      await refresh()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const onReplace = async (entry: AssetEntry, file: File) => {
    setError(null)
    try {
      await replaceAsset(sessionId, file, entry.path, entry.sha)
      bump(entry.path)
      await refresh()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Replace failed')
    }
  }

  const onDelete = async (entry: AssetEntry) => {
    setError(null)
    try {
      await deleteAsset(sessionId, entry.path, entry.sha)
      await refresh()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-surface-default">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-heading text-text-muted">Media library</div>
            <div className="font-heading font-semibold text-brand-navy text-lg">
              public/content-assets
            </div>
          </div>
          <input
            ref={uploadRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => void onUploadNew(e)}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            disabled={uploading}
            className="bg-brand-navy disabled:bg-surface-subtle disabled:text-text-muted text-text-inverse font-heading font-semibold text-xs px-4 py-2 rounded-pill transition-all hover:bg-brand-navy-dark disabled:cursor-not-allowed"
          >
            {uploading ? 'Uploading…' : 'Upload new image'}
          </button>
        </div>

        {error && <div className="text-xs font-body text-error">{error}</div>}

        {loading ? (
          <div className="text-sm font-body text-text-muted">Loading images…</div>
        ) : assets.length === 0 ? (
          <div className="text-sm font-body text-text-muted">
            No images in content-assets yet. Upload one to get started.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {assets.map((a) => (
              <MediaCard
                key={a.path}
                sessionId={sessionId}
                entry={a}
                version={versions[a.path] ?? 0}
                onReplace={(f) => void onReplace(a, f)}
                onDelete={() => void onDelete(a)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MediaCard({
  sessionId,
  entry,
  version,
  onReplace,
  onDelete,
}: {
  sessionId: string
  entry: AssetEntry
  version: number
  onReplace: (file: File) => void
  onDelete: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const filename = entry.path.split('/').pop() ?? entry.path

  return (
    <div className="bg-surface-card border border-border-default rounded-card overflow-hidden flex flex-col">
      <AssetThumb
        sessionId={sessionId}
        assetPath={entry.path}
        version={version}
        alt={filename}
        className="w-full aspect-square"
      />
      <div className="p-2 flex flex-col gap-1">
        <div className="font-mono text-[11px] text-text-secondary truncate" title={filename}>
          {filename}
        </div>
        <div className="text-[10px] font-body text-text-muted">{humanSize(entry.size)}</div>
        <div className="flex items-center gap-2 mt-1">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) onReplace(f)
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="bg-brand-cyan text-text-inverse font-heading font-semibold text-[11px] px-3 py-1 rounded-pill transition-all hover:bg-brand-cyan-dark"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-error font-heading font-semibold text-[11px] px-2 py-1 rounded-pill border border-border-default transition-all hover:bg-surface-subtle"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
