'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Database } from '@/types/database'

type Asset = Database['public']['Tables']['assets']['Row']

type StockPhotoMetadata = {
  source: 'pexels'
  pexels_id: number
  photographer: string
  photographer_url: string
  pexels_url: string
  original_query: string
  final_query: string
  avg_color: string
}

type Props = {
  sessionId: string
  assets: Asset[]
  signedUrls: Record<string, string>
}

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']
const MAX_BYTES = 25 * 1024 * 1024

/**
 * Admin UI for managing stock-photo assets resolved during a deliverable
 * package build. One row per stock-photo asset, with:
 *   - Thumbnail preview (uses signedUrls[asset.id])
 *   - Filename + photographer credit (linked to Pexels page)
 *   - "Original query" inline-editable text field
 *   - "Regenerate" button → POST /api/admin/stock-photos/regenerate
 *     with the edited query; the route re-fetches from Pexels and
 *     replaces the storage object + metadata in place. Filename stays
 *     the same so any markdown reference still resolves.
 *   - "Upload custom" button → presign + PUT + confirm, replaces the
 *     asset row with a custom upload while preserving the filename.
 *
 * Renders nothing if there are no stock photos yet (first deliverable
 * assembly creates them — admin sees an empty state until then).
 */
export default function StockPhotoManager({ assets, signedUrls }: Props) {
  const router = useRouter()
  const stockPhotos = assets.filter(a => a.asset_category === 'stock-photo')
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [editingQueries, setEditingQueries] = useState<Record<string, string>>({})

  if (stockPhotos.length === 0) {
    return (
      <div className="bg-surface-card border border-border-default rounded-lg p-4 mb-6">
        <h2 className="text-sm font-heading font-semibold text-text-primary mb-2">Stock Photos</h2>
        <p className="text-text-muted font-body text-sm">No stock photos resolved yet. Assemble the deliverable package once to fetch from Pexels — they&apos;ll appear here for review and editing.</p>
      </div>
    )
  }

  function getQuery(asset: Asset): string {
    if (asset.id in editingQueries) return editingQueries[asset.id]
    const meta = asset.metadata as StockPhotoMetadata | null
    return meta?.original_query ?? ''
  }

  async function regenerate(asset: Asset) {
    setErrors(prev => ({ ...prev, [asset.id]: '' }))
    setBusyId(asset.id)
    try {
      const query = getQuery(asset)
      const res = await fetch('/api/admin/stock-photos/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id, query }),
      })
      const data = await res.json() as { error?: string }
      if (data.error) throw new Error(data.error)
      setEditingQueries(prev => {
        const { [asset.id]: _omit, ...rest } = prev
        void _omit
        return rest
      })
      router.refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Regenerate failed'
      setErrors(prev => ({ ...prev, [asset.id]: msg }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleCustomUpload(asset: Asset, file: File) {
    setErrors(prev => ({ ...prev, [asset.id]: '' }))
    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '')
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setErrors(prev => ({ ...prev, [asset.id]: `Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` }))
      return
    }
    if (file.size > MAX_BYTES) {
      setErrors(prev => ({ ...prev, [asset.id]: 'Max 25MB' }))
      return
    }

    setBusyId(asset.id)
    try {
      // POST multipart to the replace endpoint — overwrites the existing
      // storage object in place + updates the asset row's mime_type +
      // file_size_bytes + metadata. Asset id and file_name are preserved
      // so any markdown reference to this filename continues to resolve.
      const fd = new FormData()
      fd.append('assetId', asset.id)
      fd.append('file', file)
      const res = await fetch('/api/admin/stock-photos/replace', {
        method: 'POST',
        body: fd,
      })
      const data = await res.json() as { error?: string }
      if (data.error) throw new Error(data.error)
      router.refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setErrors(prev => ({ ...prev, [asset.id]: msg }))
    } finally {
      setBusyId(null)
      const input = inputRefs.current[asset.id]
      if (input) input.value = ''
    }
  }

  return (
    <div className="bg-surface-card border border-border-default rounded-lg p-4 mb-6">
      <h2 className="text-sm font-heading font-semibold text-text-primary mb-3">
        Stock Photos ({stockPhotos.length})
      </h2>
      <div className="space-y-3">
        {stockPhotos.map(asset => {
          const meta = asset.metadata as StockPhotoMetadata | null
          const isBusy = busyId === asset.id
          const err = errors[asset.id]
          const currentQuery = getQuery(asset)
          const queryDirty = asset.id in editingQueries && currentQuery !== (meta?.original_query ?? '')
          return (
            <div key={asset.id} className="flex gap-3 p-3 border border-border-default rounded-md">
              <div className="w-24 h-16 bg-surface-subtle rounded overflow-hidden shrink-0">
                {signedUrls[asset.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={signedUrls[asset.id]} alt={asset.file_name} className="w-full h-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-body text-text-primary truncate font-medium">{asset.file_name}</p>
                  {meta?.photographer && (
                    <a
                      href={meta.pexels_url || meta.photographer_url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-text-muted hover:text-brand-cyan transition-colors flex-shrink-0"
                    >
                      © {meta.photographer}
                    </a>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={currentQuery}
                    onChange={e => setEditingQueries(prev => ({ ...prev, [asset.id]: e.target.value }))}
                    placeholder="Pexels search query"
                    disabled={isBusy}
                    className="flex-1 text-xs font-mono border border-border-default rounded px-2 py-1 text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-cyan disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => regenerate(asset)}
                    disabled={isBusy}
                    className="text-xs font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors disabled:opacity-50 flex-shrink-0"
                    title={queryDirty ? 'Fetch a new image with the edited query' : 'Re-fetch Pexels with the same query'}
                  >
                    {isBusy ? 'Working…' : queryDirty ? 'Save & regen' : 'Regen'}
                  </button>
                  <input
                    ref={el => { inputRefs.current[asset.id] = el }}
                    type="file"
                    accept={ALLOWED_EXTENSIONS.join(',')}
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) handleCustomUpload(asset, f)
                    }}
                    disabled={isBusy}
                  />
                  <button
                    type="button"
                    onClick={() => inputRefs.current[asset.id]?.click()}
                    disabled={isBusy}
                    className="text-xs font-heading font-semibold text-text-muted hover:text-brand-navy transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    Upload
                  </button>
                </div>
                {err && <p className="text-xs text-error font-body">{err}</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
