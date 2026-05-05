'use client'

import { useState, useEffect } from 'react'
import OutlineCard from './OutlineCard'
import type { Json } from '@/types/database'

type Outline = {
  id: string
  page_url: string
  page_title: string
  h1: string | null
  sections: Json
  target_keyword: string | null
  admin_approved: boolean
  admin_notes: string | null
  content_job_id: string
}

export default function OutlinePhase({
  contentJobId,
}: {
  contentJobId: string
}) {
  const [outlines, setOutlines] = useState<Outline[]>([])
  const [loading, setLoading] = useState(true)
  const [advancing, setAdvancing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval>

    const poll = async () => {
      try {
        const res = await fetch(`/api/content-jobs/${contentJobId}/outlines`)
        if (cancelled || !res.ok) return
        const data = await res.json()
        const current = data.outlines ?? []
        setOutlines(current)
        setLoading(false)
        // Stop polling once all outlines have h1 (generation done)
        if (current.length > 0 && current.every((o: Outline) => o.h1)) {
          clearInterval(intervalId)
        }
      } catch {
        if (!cancelled) setError('Failed to load outlines')
        setLoading(false)
      }
    }

    poll()
    intervalId = setInterval(poll, 5000)
    return () => { cancelled = true; clearInterval(intervalId) }
  }, [contentJobId])

  const handleUpdate = (updated: Outline) => {
    setOutlines(prev => prev.map(o => o.id === updated.id ? updated : o))
  }

  const startContentGeneration = async () => {
    setAdvancing(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: 5 }),
      })
      if (!res.ok) throw new Error('Failed to advance phase')
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance')
      setAdvancing(false)
    }
  }

  if (loading) {
    return (
      <div className="py-4 text-center">
        <div className="text-sm text-text-muted font-body">Loading outlines...</div>
      </div>
    )
  }

  const approvedCount = outlines.filter(o => o.admin_approved).length
  const allApproved = outlines.length > 0 && approvedCount === outlines.length
  const generatingCount = outlines.filter(o => !o.h1).length

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-body text-text-primary font-semibold">
          {approvedCount} of {outlines.length} pages approved
        </span>
        {generatingCount > 0 && (
          <span className="text-xs font-body text-blue-600 animate-pulse">
            {generatingCount} still generating...
          </span>
        )}
      </div>
      <div className="w-full h-2 bg-surface-subtle rounded-full overflow-hidden">
        <div
          className="h-full bg-green-500 rounded-full transition-all duration-500"
          style={{ width: `${outlines.length > 0 ? (approvedCount / outlines.length) * 100 : 0}%` }}
        />
      </div>

      {/* Outline cards */}
      <div className="space-y-2">
        {outlines.map(outline => (
          <OutlineCard
            key={outline.id}
            outline={outline}
            contentJobId={contentJobId}
            onUpdate={handleUpdate}
          />
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-body rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* Start content generation */}
      <div className="pt-2">
        <button
          onClick={startContentGeneration}
          disabled={!allApproved || advancing}
          className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-6 py-3 rounded-pill transition-all hover:bg-brand-navy-dark disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {advancing ? 'Starting...' : 'Start Content Generation →'}
        </button>
        {!allApproved && outlines.length > 0 && generatingCount === 0 && (
          <p className="text-xs text-text-muted font-body mt-2">
            Approve all outlines to enable content generation.
          </p>
        )}
      </div>
    </div>
  )
}
