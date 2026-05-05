'use client'

import { useState } from 'react'
import SitemapPageRow from './SitemapPageRow'

type SitemapPage = {
  url: string
  title: string
  status: 'new' | 'update' | 'existing'
  parent?: string
  notes?: string
}

export default function SitemapSection({
  sectionTitle,
  sectionUrl,
  pages,
  onUpdate,
}: {
  sectionTitle: string
  sectionUrl: string
  pages: SitemapPage[]
  onUpdate: (updated: SitemapPage[]) => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  const handleChange = (index: number, updated: SitemapPage) => {
    const next = [...pages]
    next[index] = updated
    onUpdate(next)
  }

  const handleRemove = (index: number) => {
    onUpdate(pages.filter((_, i) => i !== index))
  }

  const handleAdd = () => {
    const baseSlug = sectionUrl === '/' ? '' : sectionUrl
    onUpdate([
      ...pages,
      { url: `${baseSlug}/new-page`, title: '', status: 'new' as const, parent: sectionUrl },
    ])
  }

  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-subtle hover:bg-surface-subtle/80 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 text-text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-heading font-semibold text-text-primary">
            {sectionTitle}
          </span>
          <span className="text-xs text-text-muted font-body">
            {pages.length} page{pages.length !== 1 ? 's' : ''}
          </span>
        </div>
        <span className="text-xs font-mono text-text-muted">{sectionUrl}</span>
      </button>

      {!collapsed && (
        <div className="px-2 py-1">
          {pages.map((page, i) => (
            <SitemapPageRow
              key={`${page.url}-${i}`}
              page={page}
              onChange={updated => handleChange(i, updated)}
              onRemove={() => handleRemove(i)}
            />
          ))}
          <button
            type="button"
            onClick={handleAdd}
            className="w-full text-left px-3 py-2 text-sm font-body text-brand-cyan hover:text-brand-navy transition-colors"
          >
            + Add Page
          </button>
        </div>
      )}
    </div>
  )
}
