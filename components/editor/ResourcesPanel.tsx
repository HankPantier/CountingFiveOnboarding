'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type ScoreBreakdown = {
  stickiness?: number
  sharability?: number
  localRelevance?: number
  aioAnswerability?: number
}

type ExternalLink = { url: string; title?: string }

export type ResourceIdea = {
  id: string
  title: string
  angle: string | null
  target_keyword: string | null
  secondary_keywords: string[]
  rationale: string | null
  score: number | null
  score_breakdown: ScoreBreakdown
  external_links: ExternalLink[]
  status: 'suggested' | 'approved' | 'drafted' | 'dismissed'
  draft_status: 'idle' | 'running' | 'complete' | 'error'
  slug: string | null
  draft_path: string | null
  draft_error: string | null
}

const POLL_MS = 5000

const SCORE_LABELS: Array<{ key: keyof ScoreBreakdown; label: string }> = [
  { key: 'stickiness', label: 'Sticky' },
  { key: 'sharability', label: 'Sharable' },
  { key: 'localRelevance', label: 'Local' },
  { key: 'aioAnswerability', label: 'AIO' },
]

export default function ResourcesPanel({
  sessionId,
  onOpenPost,
}: {
  sessionId: string
  onOpenPost: (path: string) => void
}) {
  const [ideas, setIdeas] = useState<ResourceIdea[]>([])
  const [loading, setLoading] = useState(true)
  const [brainstorming, setBrainstorming] = useState(false)
  const [seed, setSeed] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Idea count at brainstorm start, so polling knows when new rows arrive.
  const brainstormBaseline = useRef<number | null>(null)

  const refresh = useCallback(async (): Promise<ResourceIdea[]> => {
    const res = await fetch(`/api/edit/${sessionId}/resources/ideas`)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error ?? `Failed to load ideas: ${res.status}`)
    }
    const data = (await res.json()) as { ideas: ResourceIdea[] }
    setIdeas(data.ideas)
    return data.ideas
  }, [sessionId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load ideas'))
      .finally(() => setLoading(false))
  }, [refresh])

  // Poll while a brainstorm or any draft is in flight.
  const anyDrafting = ideas.some((i) => i.draft_status === 'running')
  useEffect(() => {
    if (!brainstorming && !anyDrafting) return
    const timer = setInterval(() => {
      void refresh()
        .then((next) => {
          if (
            brainstorming &&
            brainstormBaseline.current !== null &&
            next.length > brainstormBaseline.current
          ) {
            setBrainstorming(false)
            brainstormBaseline.current = null
          }
        })
        .catch(() => {})
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [brainstorming, anyDrafting, refresh])

  const brainstorm = async (seedIdea?: string) => {
    setError(null)
    setBrainstorming(true)
    brainstormBaseline.current = ideas.length
    try {
      const res = await fetch(`/api/edit/${sessionId}/resources/brainstorm`, {
        method: 'POST',
        ...(seedIdea
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ seed: seedIdea }),
            }
          : {}),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Brainstorm failed: ${res.status}`)
      }
      if (seedIdea) setSeed('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Brainstorm failed')
      setBrainstorming(false)
      brainstormBaseline.current = null
    }
  }

  const setStatus = async (ideaId: string, status: 'approved' | 'dismissed' | 'suggested') => {
    setError(null)
    try {
      const res = await fetch(`/api/edit/${sessionId}/resources/ideas/${ideaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Update failed: ${res.status}`)
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const draft = async (ideaId: string) => {
    setError(null)
    try {
      const res = await fetch(`/api/edit/${sessionId}/resources/ideas/${ideaId}/draft`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Draft failed: ${res.status}`)
      }
      // Optimistic: show the running state immediately; polling takes over.
      setIdeas((prev) =>
        prev.map((i) => (i.id === ideaId ? { ...i, draft_status: 'running' as const } : i))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Draft failed')
    }
  }

  const visible = ideas.filter((i) => i.status !== 'dismissed')
  const dismissedCount = ideas.length - visible.length

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-heading text-lg font-semibold text-brand-navy">Resources — blog posts</h2>
        <button
          onClick={() => void brainstorm()}
          disabled={brainstorming}
          className="rounded-[40px] bg-brand-cyan px-5 py-2 text-sm font-heading font-semibold text-white hover:opacity-90 disabled:bg-surface-subtle disabled:text-text-muted transition-colors"
        >
          {brainstorming ? 'Brainstorming…' : 'Brainstorm ideas'}
        </button>
      </div>
      <p className="text-xs font-body text-text-muted mb-4">
        Researches sticky, sharable angles for this firm, drafts on-brand posts to the draft branch
        under <code>content/posts/</code>, then you edit and publish like any page.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (seed.trim() && !brainstorming) void brainstorm(seed.trim())
        }}
        className="mb-5 flex items-center gap-2"
      >
        <input
          type="text"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          maxLength={300}
          placeholder="Or seed your own idea — e.g. “year-end equipment purchases for contractors”"
          className="flex-1 rounded-[40px] border border-border-default bg-surface-card px-4 py-2 text-xs font-body text-text-secondary placeholder:text-text-muted focus:outline-none focus:border-brand-cyan"
        />
        <button
          type="submit"
          disabled={brainstorming || !seed.trim()}
          className="rounded-[40px] border border-brand-navy px-5 py-2 text-xs font-heading font-semibold text-brand-navy hover:bg-brand-navy/5 disabled:border-border-default disabled:text-text-muted transition-colors"
        >
          Extrapolate
        </button>
      </form>

      {error && (
        <div className="mb-4 rounded border border-error/30 bg-error/5 px-3 py-2 text-xs font-body text-error">
          {error}
        </div>
      )}

      {brainstorming && (
        <div className="mb-4 rounded border border-border-default bg-surface-card px-3 py-2 text-xs font-body text-text-secondary">
          Researching angles and scoring ideas — this takes about a minute. New ideas appear below
          automatically.
        </div>
      )}

      {loading ? (
        <p className="text-sm font-body text-text-muted">Loading ideas…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm font-body text-text-muted">
          No ideas yet. Click “Brainstorm ideas” to generate scored post ideas for this client.
        </p>
      ) : (
        <ul className="space-y-4">
          {visible.map((idea) => (
            <li
              key={idea.id}
              className="rounded-lg border border-border-default bg-surface-card p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-heading text-sm font-semibold text-brand-navy">
                    {idea.title}
                  </h3>
                  {idea.angle && (
                    <p className="mt-1 text-xs font-body text-text-secondary">{idea.angle}</p>
                  )}
                </div>
                {typeof idea.score === 'number' && (
                  <div className="shrink-0 text-right">
                    <span className="font-heading text-lg font-semibold text-brand-navy">
                      {idea.score}
                    </span>
                    <span className="text-xs font-body text-text-muted">/100</span>
                  </div>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {SCORE_LABELS.map(({ key, label }) =>
                  typeof idea.score_breakdown?.[key] === 'number' ? (
                    <span
                      key={key}
                      className="rounded-full bg-surface-subtle px-2 py-0.5 text-[10px] font-body text-text-secondary"
                    >
                      {label} {idea.score_breakdown[key]}
                    </span>
                  ) : null
                )}
                {idea.target_keyword && (
                  <span className="rounded-full bg-brand-cyan/10 px-2 py-0.5 text-[10px] font-body text-brand-navy">
                    {idea.target_keyword}
                  </span>
                )}
              </div>

              {idea.rationale && (
                <p className="mt-2 text-xs font-body text-text-muted">{idea.rationale}</p>
              )}

              {idea.external_links.length > 0 && (
                <p className="mt-2 text-[11px] font-body text-text-muted">
                  Verified sources:{' '}
                  {idea.external_links.map((l, i) => (
                    <span key={l.url}>
                      {i > 0 && ' · '}
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-navy underline hover:text-brand-cyan"
                      >
                        {l.title || new URL(l.url).hostname}
                      </a>
                    </span>
                  ))}
                </p>
              )}

              <div className="mt-3 flex items-center gap-2">
                {idea.status === 'drafted' && idea.draft_path ? (
                  <button
                    onClick={() => onOpenPost(idea.draft_path!)}
                    className="rounded-[40px] bg-brand-navy px-4 py-1.5 text-xs font-heading font-semibold text-white hover:opacity-90 transition-colors"
                  >
                    Open draft
                  </button>
                ) : idea.draft_status === 'running' ? (
                  <span className="text-xs font-body text-info">Drafting post…</span>
                ) : (
                  <>
                    <button
                      onClick={() => void draft(idea.id)}
                      className="rounded-[40px] bg-brand-cyan px-4 py-1.5 text-xs font-heading font-semibold text-white hover:opacity-90 transition-colors"
                    >
                      Draft post
                    </button>
                    {idea.status === 'suggested' && (
                      <button
                        onClick={() => void setStatus(idea.id, 'approved')}
                        className="rounded-[40px] border border-brand-navy px-4 py-1.5 text-xs font-heading font-semibold text-brand-navy hover:bg-brand-navy/5 transition-colors"
                      >
                        Approve
                      </button>
                    )}
                    <button
                      onClick={() => void setStatus(idea.id, 'dismissed')}
                      className="rounded-[40px] px-4 py-1.5 text-xs font-heading font-semibold text-text-muted hover:text-text-secondary transition-colors"
                    >
                      Dismiss
                    </button>
                  </>
                )}
                {idea.status === 'approved' && idea.draft_status !== 'running' && (
                  <span className="text-[10px] font-body uppercase tracking-wide text-success">
                    Approved
                  </span>
                )}
                {idea.draft_status === 'error' && (
                  <span className="text-xs font-body text-error">
                    Draft failed{idea.draft_error ? `: ${idea.draft_error}` : ''} — try again
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {dismissedCount > 0 && (
        <p className="mt-4 text-[11px] font-body text-text-muted">
          {dismissedCount} dismissed idea{dismissedCount === 1 ? '' : 's'} hidden (kept for dedupe).
        </p>
      )}
    </div>
  )
}
