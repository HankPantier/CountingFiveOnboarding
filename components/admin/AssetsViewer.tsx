import type { Database } from '@/types/database'

type Asset = Database['public']['Tables']['assets']['Row']

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export default function AssetsViewer({ assets }: { assets: Asset[] }) {
  if (!assets.length) {
    return (
      <div className="bg-surface-card border border-border-default rounded-lg p-4 mb-6">
        <h2 className="text-sm font-heading font-semibold text-text-primary mb-2">Uploaded Files</h2>
        <p className="text-text-muted font-body text-sm">No files uploaded yet.</p>
      </div>
    )
  }

  return (
    <div className="bg-surface-card border border-border-default rounded-lg p-4 mb-6">
      <h2 className="text-sm font-heading font-semibold text-text-primary mb-3">
        Uploaded Files ({assets.length})
      </h2>
      <div className="space-y-2">
        {assets.map(asset => (
          <div
            key={asset.id}
            className="flex items-center justify-between py-2 border-b border-border-default last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-body text-text-primary truncate">{asset.file_name}</p>
              <p className="text-xs text-text-muted font-body">
                {asset.asset_category ?? 'other'} · {asset.mime_type} · {formatBytes(asset.file_size_bytes)}
              </p>
            </div>
            <a
              href={asset.storage_path}
              className="ml-4 text-xs font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors flex-shrink-0"
              target="_blank"
              rel="noopener noreferrer"
            >
              View
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}
