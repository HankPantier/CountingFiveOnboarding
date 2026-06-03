'use client'

import { useEffect, useRef, useState } from 'react'
import AssetThumb from './AssetThumb'
import { listAssets, createAsset, type AssetEntry } from '@/lib/editor/asset-client'
import { ASSET_ROOT } from '@/lib/editor/page-images'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

// Header-image control for blog posts: shows the current `image:` frontmatter
// value, lets the admin swap it for any image already in the repo's media
// library, upload a new one, or clear it. Writes the bare filename back into
// frontmatter (the template resolves it to /content-assets/<file>).
export default function HeaderImagePicker({
  sessionId,
  value,
  onChange,
}: {
  sessionId: string
  value: string
  onChange: (filename: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [browsing, setBrowsing] = useState(false)
  const [assets, setAssets] = useState<AssetEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!browsing || assets !== null) return
    listAssets(sessionId)
      .then((list) =>
        setAssets(list.filter((a) => a.path.startsWith(ASSET_ROOT) && !a.path.endsWith('.svg')))
      )
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load library'))
  }, [browsing, assets, sessionId])

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const safeName = file.name.toLowerCase().replace(/[^a-z0-9.-]+/g, '-')
      await createAsset(sessionId, file, ASSET_ROOT + safeName)
      setAssets(null) // refetch on next browse
      onChange(safeName)
      setBrowsing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <span className="block text-xs font-heading text-text-secondary mb-1">Header image</span>
      <div className="flex items-center gap-3">
        {value ? (
          <AssetThumb
            sessionId={sessionId}
            assetPath={ASSET_ROOT + value}
            version={0}
            alt=""
            className="w-24 h-16 rounded-card border border-border-default shrink-0 object-cover"
          />
        ) : (
          <div className="w-24 h-16 rounded-card border border-dashed border-border-default shrink-0 flex items-center justify-center text-[10px] font-body text-text-muted">
            No image
          </div>
        )}
        <div className="min-w-0">
          {value && (
            <div className="font-mono text-xs text-text-secondary truncate mb-1">{value}</div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBrowsing((b) => !b)}
              className="bg-brand-cyan text-text-inverse font-heading font-semibold text-[11px] px-3 py-1 rounded-pill transition-all hover:bg-brand-navy-dark"
            >
              {browsing ? 'Close library' : 'Choose from library'}
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="border border-brand-navy text-brand-navy font-heading font-semibold text-[11px] px-3 py-1 rounded-pill transition-all hover:bg-brand-navy/5 disabled:border-border-default disabled:text-text-muted"
            >
              {busy ? 'Uploading…' : 'Upload new'}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="text-[11px] font-heading text-text-muted hover:text-text-secondary"
              >
                Remove
              </button>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => void upload(e)}
            className="hidden"
          />
        </div>
      </div>
      {error && <div className="mt-1 text-[11px] font-body text-error">{error}</div>}
      {browsing && (
        <div className="mt-3 grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-56 overflow-y-auto rounded border border-border-default p-2 bg-surface-default">
          {assets === null ? (
            <span className="col-span-full text-xs font-body text-text-muted p-2">Loading…</span>
          ) : assets.length === 0 ? (
            <span className="col-span-full text-xs font-body text-text-muted p-2">
              No images in the library yet — upload one.
            </span>
          ) : (
            assets.map((a) => {
              const filename = a.path.slice(ASSET_ROOT.length)
              return (
                <button
                  key={a.path}
                  type="button"
                  onClick={() => {
                    onChange(filename)
                    setBrowsing(false)
                  }}
                  title={filename}
                  className={`rounded-card border-2 overflow-hidden transition-colors ${
                    filename === value ? 'border-brand-cyan' : 'border-transparent hover:border-border-default'
                  }`}
                >
                  <AssetThumb
                    sessionId={sessionId}
                    assetPath={a.path}
                    version={0}
                    alt={filename}
                    className="w-full h-14 object-cover"
                  />
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
