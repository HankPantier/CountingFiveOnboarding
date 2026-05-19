'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import MarkdownPreviewModal from './MarkdownPreviewModal'

type ReviewListPage = {
  id: string
  page_url: string
  page_title: string
  word_count_actual: number | null
  word_count_target: number | null
  client_approved_content: boolean
}

function wordCountBadge(
  actual: number | null | undefined,
  target: number | null | undefined
): { label: string; cls: string } | null {
  if (actual == null) return null
  if (!target) {
    return { label: `${actual} words`, cls: 'text-text-muted bg-surface-subtle' }
  }
  const variance = (actual - target) / target
  const pct = Math.round(variance * 100)
  if (Math.abs(variance) > 0.25) {
    return {
      label: `⚠ ${actual} / ${target} (${pct >= 0 ? '+' : ''}${pct}%)`,
      cls: 'text-amber-800 bg-amber-50',
    }
  }
  return { label: `${actual} / ${target}`, cls: 'text-text-muted bg-surface-subtle' }
}

export default function ClientReviewList({
  contentJobId,
  pages,
}: {
  contentJobId: string
  pages: ReviewListPage[]
}) {
  const router = useRouter()
  const [previewPageId, setPreviewPageId] = useState<string | null>(null)

  if (pages.length === 0) {
    return (
      <p className="text-sm text-text-muted font-body">
        No pages currently need your review. You can close this page — we'll be in touch if anything else needs your input.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {pages.map(page => {
        const wcBadge = wordCountBadge(page.word_count_actual, page.word_count_target)
        return (
          <div
            key={page.id}
            className="bg-white border border-border-default rounded-lg p-4 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-base font-heading font-semibold text-text-primary mb-1">
                  {page.page_title}
                </div>
                <div className="text-xs font-mono text-text-muted truncate">
                  {page.page_url}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {wcBadge && (
                  <span className={`text-xs font-mono px-2 py-1 rounded ${wcBadge.cls}`}>
                    {wcBadge.label}
                  </span>
                )}
                <span
                  className={`text-xs font-mono px-2 py-1 rounded ${
                    page.client_approved_content
                      ? 'text-green-700 bg-green-50'
                      : 'text-amber-700 bg-amber-50'
                  }`}
                >
                  {page.client_approved_content ? 'Client ✓' : 'Awaiting your approval'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border-default">
              <button
                type="button"
                onClick={() => setPreviewPageId(page.id)}
                className="bg-brand-cyan text-white text-xs font-heading font-semibold px-3 py-1.5 rounded-pill hover:bg-brand-cyan/90 transition-all"
              >
                View
              </button>
            </div>
          </div>
        )
      })}

      {previewPageId && (
        <MarkdownPreviewModal
          contentJobId={contentJobId}
          pageId={previewPageId}
          mode="client"
          onClose={() => {
            setPreviewPageId(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
