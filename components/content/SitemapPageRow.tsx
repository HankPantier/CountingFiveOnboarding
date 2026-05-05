'use client'

type SitemapPage = {
  url: string
  title: string
  status: 'new' | 'update' | 'existing'
  parent?: string
  notes?: string
}

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  new:      { label: '🆕 New',      cls: 'bg-blue-50 text-blue-700' },
  update:   { label: '📈 Update',   cls: 'bg-amber-50 text-amber-700' },
  existing: { label: '✅ Existing', cls: 'bg-green-50 text-green-700' },
}

function formatSlug(raw: string): string {
  let slug = raw.toLowerCase().replace(/[^a-z0-9/\-]/g, '-').replace(/-+/g, '-').replace(/-$/, '')
  if (!slug.startsWith('/')) slug = '/' + slug
  return slug
}

export default function SitemapPageRow({
  page,
  onChange,
  onRemove,
}: {
  page: SitemapPage
  onChange: (updated: SitemapPage) => void
  onRemove: () => void
}) {
  const badge = STATUS_BADGES[page.status] ?? STATUS_BADGES.new

  return (
    <div className="flex items-center gap-2 py-2 px-3 rounded-md hover:bg-surface-subtle transition-colors group">
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-heading font-semibold flex-shrink-0 ${badge.cls}`}>
        {badge.label}
      </span>
      <input
        type="text"
        value={page.title}
        onChange={e => onChange({ ...page, title: e.target.value })}
        placeholder="Page title"
        className="flex-1 min-w-0 px-2 py-1 text-sm font-body bg-transparent border border-transparent hover:border-border-default focus:border-brand-cyan focus:outline-none rounded transition-colors"
      />
      <input
        type="text"
        value={page.url}
        onChange={e => onChange({ ...page, url: e.target.value })}
        onBlur={e => onChange({ ...page, url: formatSlug(e.target.value) })}
        placeholder="/url-slug"
        className="w-[220px] flex-shrink-0 px-2 py-1 text-sm font-mono text-text-secondary bg-transparent border border-transparent hover:border-border-default focus:border-brand-cyan focus:outline-none rounded transition-colors"
      />
      <button
        type="button"
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-all p-1 flex-shrink-0"
        aria-label={`Remove ${page.title}`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
