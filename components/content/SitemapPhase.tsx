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

function titleFromUrl(url: string): string {
  const seg = url.split('/').filter(Boolean).pop() ?? ''
  const t = seg.replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase())
  return t || url
}

function groupBySections(pages: SitemapPage[]): SectionGroup[] {
  const byUrl = new Map(pages.map(p => [p.url, p] as const))
  const isTop = (p: SitemapPage) => !p.parent || p.parent === '/'

  // One section per parent that actually has children — works whether or not the
  // parent hub page itself is in the list (a niche/service hub without its own
  // row still forms a section, instead of dumping children into "Root").
  const childrenByParent = new Map<string, SitemapPage[]>()
  for (const p of pages) {
    if (!isTop(p)) {
      const arr = childrenByParent.get(p.parent as string) ?? []
      arr.push(p)
      childrenByParent.set(p.parent as string, arr)
    }
  }

  const groups: SectionGroup[] = []
  const claimed = new Set<string>()

  for (const [parentUrl, kids] of childrenByParent) {
    const hub = byUrl.get(parentUrl)
    if (hub) claimed.add(hub.url)
    kids.forEach(k => claimed.add(k.url))
    groups.push({
      title: hub?.title || titleFromUrl(parentUrl),
      url: parentUrl,
      pages: hub ? [hub, ...kids] : kids,
    })
  }

  // Remaining top-level pages that aren't section hubs.
  const rest = pages.filter(p => !claimed.has(p.url))
  if (rest.length) groups.unshift({ title: 'Main pages', url: '/', pages: rest })

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
  const [proposing, setProposing] = useState(false)
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

  useEffect(() => {
    // Data-loading-on-mount pattern: loadSitemap is async and only setState's
    // after fetch resolves, but ESLint flags any indirect setState reference
    // inside an effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSitemap()
  }, [loadSitemap])

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

  const regenerateWithAI = async () => {
    setProposing(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/sitemap/propose`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to generate proposals')
      }
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate proposals')
      setProposing(false)
    }
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
        <div className="bg-error/10 border border-error/20 text-error text-sm font-body rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      <div className="pt-2 flex items-center gap-2">
        <button
          onClick={confirmSitemap}
          disabled={saving || proposing || pages.length === 0}
          className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Confirm Sitemap & Continue'}
        </button>
        <button
          type="button"
          onClick={regenerateWithAI}
          disabled={proposing || saving}
          className="border border-brand-cyan text-brand-cyan font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-colors hover:bg-brand-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {proposing ? 'Generating proposals…' : '✨ Regenerate with AI'}
        </button>
      </div>
    </div>
  )
}
