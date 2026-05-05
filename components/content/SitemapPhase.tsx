'use client'

import { useState, useEffect, useCallback } from 'react'
import SitemapSection from './SitemapSection'

type SitemapPage = {
  url: string
  title: string
  status: 'new' | 'update' | 'existing'
  parent?: string
  notes?: string
}

type SectionGroup = {
  title: string
  url: string
  pages: SitemapPage[]
}

function groupBySections(pages: SitemapPage[]): SectionGroup[] {
  // Find top-level pages (parent is "/" or undefined) and group children under them
  const topLevel = pages.filter(p => !p.parent || p.parent === '/')
  const children = pages.filter(p => p.parent && p.parent !== '/')

  const groups: SectionGroup[] = []

  // Root pages that have children become section headers
  const parentUrls = new Set(children.map(c => c.parent!))

  for (const page of topLevel) {
    if (parentUrls.has(page.url)) {
      // This page is a section header
      const sectionChildren = children.filter(c => c.parent === page.url)
      groups.push({
        title: page.title,
        url: page.url,
        pages: [page, ...sectionChildren],
      })
    } else {
      // Standalone top-level page — group under "Root"
      const existing = groups.find(g => g.url === '/')
      if (existing) {
        existing.pages.push(page)
      } else {
        groups.push({ title: 'Root', url: '/', pages: [page] })
      }
    }
  }

  // Any children whose parent wasn't found as a top-level page
  const assignedUrls = new Set(groups.flatMap(g => g.pages.map(p => p.url)))
  const orphans = children.filter(c => !assignedUrls.has(c.url))
  if (orphans.length > 0) {
    const misc = groups.find(g => g.url === '/')
    if (misc) misc.pages.push(...orphans)
    else groups.push({ title: 'Other', url: '/', pages: orphans })
  }

  return groups
}

export default function SitemapPhase({
  contentJobId,
}: {
  contentJobId: string
}) {
  const [pages, setPages] = useState<SitemapPage[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSitemap = useCallback(async () => {
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/sitemap`)
      if (!res.ok) throw new Error('Failed to load sitemap')
      const data = await res.json()
      setPages(data.pages ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [contentJobId])

  useEffect(() => { loadSitemap() }, [loadSitemap])

  const groups = groupBySections(pages)

  const handleSectionUpdate = (sectionUrl: string, updatedPages: SitemapPage[]) => {
    setPages(prev => {
      // Remove old pages from this section, add updated ones
      const group = groupBySections(prev).find(g => g.url === sectionUrl)
      if (!group) return prev
      const oldUrls = new Set(group.pages.map(p => p.url))
      const otherPages = prev.filter(p => !oldUrls.has(p.url))
      return [...otherPages, ...updatedPages]
    })
  }

  const confirmSitemap = async () => {
    // Validate
    const invalid = pages.find(p => !p.title?.trim() || !p.url?.trim())
    if (invalid) {
      setError('All pages must have a title and URL')
      return
    }
    if (pages.length === 0) {
      setError('At least one page is required')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/sitemap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to confirm sitemap')
      }
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="py-6 text-center">
        <div className="text-sm text-text-muted font-body">Loading sitemap...</div>
      </div>
    )
  }

  const newCount = pages.filter(p => p.status === 'new').length
  const updateCount = pages.filter(p => p.status === 'update').length
  const existingCount = pages.filter(p => p.status === 'existing').length

  // Rough cost estimate: ~3 API calls per page (research + outline + generation)
  const estCalls = pages.length * 3
  const estCost = (pages.length * 0.15).toFixed(2) // ~$0.15 per page average

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-body text-text-primary">
          <span className="font-semibold">{pages.length} pages</span>
          <span className="text-text-muted ml-2">
            {newCount} new · {updateCount} updates · {existingCount} existing
          </span>
        </div>
        <div className="text-xs font-body text-text-muted">
          ~{estCalls} API calls · Est. ${estCost}
        </div>
      </div>

      <div className="space-y-3">
        {groups.map(group => (
          <SitemapSection
            key={group.url}
            sectionTitle={group.title}
            sectionUrl={group.url}
            pages={group.pages}
            onUpdate={updated => handleSectionUpdate(group.url, updated)}
          />
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-body rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      <div className="pt-2">
        <button
          onClick={confirmSitemap}
          disabled={saving || pages.length === 0}
          className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-6 py-3 rounded-pill transition-all hover:bg-brand-navy-dark disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Confirm Sitemap & Continue'}
        </button>
      </div>
    </div>
  )
}
