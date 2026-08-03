'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrandFitResult } from '@/lib/content/brand-fit'
import BrandConflictCard from './BrandConflictCard'

type ScoreBreakdown = {
  stickiness?: number
  sharability?: number
  localRelevance?: number
  aioAnswerability?: number
}

type ExternalLink = { url: string; title?: string }

type ReverseLink = { slug: string; path: string; anchorText: string; insertedInto: string }

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
  social_path: string | null
  social_status: 'idle' | 'running' | 'complete' | 'error'
  reverse_links: ReverseLink[]
}

// Render a markdown link as plain text ([anchor](url) → anchor) so the
// reverse-link tooltip reads as prose instead of raw markdown.
function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
}

// Interested/drafted float to the top, then by score.
function sortIdeas(ideas: ResourceIdea[]): ResourceIdea[] {
  const rank = (i: ResourceIdea) => (i.status === 'drafted' ? 0 : i.status === 'approved' ? 1 : 2)
  return [...ideas].sort((a, b) => rank(a) - rank(b) || (b.score ?? 0) - (a.score ?? 0))
}

const POLL_MS = 5000
// The reverse-link commit + DB write lands shortly AFTER draft_status flips to
// 'complete', so we keep polling a short grace window past completion to pick
// up the reverse_links audit without a manual reload.
const REVERSE_LINK_GRACE_CYCLES = 8 // ~40s at POLL_MS

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
  // Ideas with a social backfill in flight (cleared when social_path arrives).
  const [socialBusy, setSocialBusy] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  // Idea with the writer-notes box open, and its text.
  const [notesFor, setNotesFor] = useState<string | null>(null)
  const [notesText, setNotesText] = useState('')
  // Brand-fit conflict awaiting an admin decision (seed or draft notes).
  const [brandConflict, setBrandConflict] = useState<{
    action: { kind: 'seed'; seed: string } | { kind: 'draft'; ideaId: string; notes: string }
    fit: BrandFitResult
  } | null>(null)
  const [amending, setAmending] = useState(false)
  // Idea count at brainstorm start, so polling knows when new rows arrive.
  const brainstormBaseline = useRef<number | null>(null)
  // Per-idea draft_status from the last refresh, used to detect the
  // running→complete transition that starts a reverse-link grace window.
  const prevDraftStatus = useRef<Map<string, string>>(new Map())
  // Ideas awaiting their reverse_links write → poll cycles remaining.
  const reverseLinkWatch = useRef<Map<string, number>>(new Map())
  // Mirrors reverseLinkWatch.size into render state so the poll effect re-runs.
  const [settling, setSettling] = useState(false)

  const refresh = useCallback(async (): Promise<ResourceIdea[]> => {
    const res = await fetch(`/api/edit/${sessionId}/resources/ideas`)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error ?? `Failed to load ideas: ${res.status}`)
    }
    const data = (await res.json()) as { ideas: ResourceIdea[] }
    setIdeas(data.ideas)

    const watch = reverseLinkWatch.current
    for (const idea of data.ideas) {
      if (prevDraftStatus.current.get(idea.id) === 'running' && idea.draft_status === 'complete') {
        watch.set(idea.id, REVERSE_LINK_GRACE_CYCLES)
      }
      prevDraftStatus.current.set(idea.id, idea.draft_status)
      if (watch.has(idea.id)) {
        if (idea.reverse_links.length > 0) {
          watch.delete(idea.id)
        } else {
          const left = (watch.get(idea.id) ?? 0) - 1
          if (left <= 0) watch.delete(idea.id)
          else watch.set(idea.id, left)
        }
      }
    }
    setSettling(watch.size > 0)

    return data.ideas
  }, [sessionId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load ideas'))
      .finally(() => setLoading(false))
  }, [refresh])

  // Poll while a brainstorm, draft, or social backfill is in flight.
  const anyDrafting = ideas.some((i) => i.draft_status === 'running')
  const anySocial = socialBusy.size > 0
  useEffect(() => {
    if (!brainstorming && !anyDrafting && !anySocial && !settling) return
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
          // Clear social spinners once the path lands (success) or the row
          // reports an error — otherwise a failed backfill spins forever.
          let socialFailed = false
          setSocialBusy((prev) => {
            if (prev.size === 0) return prev
            const stillBusy = new Set<string>()
            for (const id of prev) {
              const idea = next.find((i) => i.id === id)
              if (!idea) continue
              if (idea.social_path) continue
              if (idea.social_status === 'error') {
                socialFailed = true
                continue
              }
              stillBusy.add(id)
            }
            return stillBusy.size === prev.size ? prev : stillBusy
          })
          if (socialFailed) setError('Social generation failed — try again')
        })
        .catch(() => {})
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [brainstorming, anyDrafting, anySocial, settling, refresh])

  const brainstorm = async (seedIdea?: string, overrideBrandFit = false) => {
    setError(null)
    setBrandConflict(null)
    setBrainstorming(true)
    brainstormBaseline.current = ideas.length
    try {
      const res = await fetch(`/api/edit/${sessionId}/resources/brainstorm`, {
        method: 'POST',
        ...(seedIdea
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ seed: seedIdea, overrideBrandFit }),
            }
          : {}),
      })
      if (res.status === 409 && seedIdea) {
        const data = (await res.json().catch(() => ({}))) as { brandFit?: BrandFitResult }
        if (data.brandFit) {
          setBrandConflict({ action: { kind: 'seed', seed: seedIdea }, fit: data.brandFit })
          setBrainstorming(false)
          brainstormBaseline.current = null
          return
        }
      }
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

  const generateSocial = async (ideaId: string) => {
    setError(null)
    setSocialBusy((prev) => new Set(prev).add(ideaId))
    try {
      const res = await fetch(`/api/edit/${sessionId}/resources/ideas/${ideaId}/social`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Social generation failed: ${res.status}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Social generation failed')
      setSocialBusy((prev) => {
        const next = new Set(prev)
        next.delete(ideaId)
        return next
      })
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

  const draft = async (ideaId: string, notes: string, overrideBrandFit = false) => {
    setError(null)
    setBrandConflict(null)
    try {
      const res = await fetch(`/api/edit/${sessionId}/resources/ideas/${ideaId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes || undefined, overrideBrandFit }),
      })
      if (res.status === 409 && notes) {
        const data = (await res.json().catch(() => ({}))) as { brandFit?: BrandFitResult; error?: string }
        if (data.brandFit) {
          setBrandConflict({ action: { kind: 'draft', ideaId, notes }, fit: data.brandFit })
          return
        }
        throw new Error(data.error ?? 'Draft already in progress')
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Draft failed: ${res.status}`)
      }
      setNotesFor(null)
      setNotesText('')
      // Optimistic: show the running state immediately; polling takes over.
      setIdeas((prev) =>
        prev.map((i) => (i.id === ideaId ? { ...i, draft_status: 'running' as const } : i))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Draft failed')
    }
  }

  // Re-run the gated action with the admin's override after a brand conflict.
  const proceedOffBrand = async () => {
    if (!brandConflict) return
    const { action } = brandConflict
    if (action.kind === 'seed') await brainstorm(action.seed, true)
    else await draft(action.ideaId, action.notes, true)
  }

  // Apply the proposed brand amendment first, then proceed with the action —
  // the divergence becomes part of the documented brand.
  const amendAndProceed = async () => {
    if (!brandConflict?.fit.proposedAmendment) return
    setAmending(true)
    setError(null)
    try {
      const res = await fetch(`/api/edit/${sessionId}/resources/brand-amendment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(brandConflict.fit.proposedAmendment),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Brand update failed: ${res.status}`)
      }
      await proceedOffBrand()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Brand update failed')
    } finally {
      setAmending(false)
    }
  }

  const visible = sortIdeas(ideas.filter((i) => i.status !== 'dismissed'))

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-heading text-lg font-semibold text-brand-navy">Resources — blog posts</h2>
        <button
          onClick={() => void brainstorm()}
          disabled={brainstorming}
          className="rounded-pill bg-brand-cyan px-3.5 py-1.5 text-xs font-heading font-semibold text-white hover:opacity-90 disabled:bg-surface-subtle disabled:text-text-muted transition-colors"
        >
          {brainstorming ? 'Brainstorming…' : ideas.length > 0 ? 'Brainstorm more' : 'Brainstorm ideas'}
        </button>
      </div>
      <p className="text-xs font-body text-text-muted mb-4">
        Researches sticky, sharable angles for this firm, drafts on-brand posts to the draft branch
        under <code>content/posts/</code>, then you edit and publish like any page. Brainstorming
        adds to the list without touching kept ideas; removed ideas won&apos;t be suggested again.
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
          className="flex-1 rounded-pill border border-border-default bg-surface-card px-3.5 py-1.5 text-xs font-body text-text-secondary placeholder:text-text-muted focus:outline-none focus:border-brand-cyan"
        />
        <button
          type="submit"
          disabled={brainstorming || !seed.trim()}
          className="rounded-pill border border-brand-navy px-3.5 py-1.5 text-xs font-heading font-semibold text-brand-navy hover:bg-brand-navy/5 disabled:border-border-default disabled:text-text-muted transition-colors"
        >
          Extrapolate
        </button>
      </form>

      {error && (
        <div className="mb-4 rounded border border-error/30 bg-error/5 px-3 py-2 text-xs font-body text-error">
          {error}
        </div>
      )}

      {brandConflict && (
        <BrandConflictCard
          requestText={
            brandConflict.action.kind === 'seed' ? brandConflict.action.seed : brandConflict.action.notes
          }
          fit={brandConflict.fit}
          amending={amending}
          onRevise={() => setBrandConflict(null)}
          onProceed={() => void proceedOffBrand()}
          onAmendAndProceed={() => void amendAndProceed()}
        />
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
                {idea.status === 'approved' && (
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-heading font-semibold text-success">
                    ★ Interested
                  </span>
                )}
                {idea.status === 'drafted' && (
                  <span className="rounded-full bg-brand-navy/10 px-2 py-0.5 text-[10px] font-heading font-semibold text-brand-navy">
                    Drafted
                  </span>
                )}
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

              {idea.reverse_links.length > 0 && (
                <p className="mt-2 text-[11px] font-body text-text-muted">
                  Linked back from {idea.reverse_links.length} existing{' '}
                  {idea.reverse_links.length === 1 ? 'post' : 'posts'}:{' '}
                  {idea.reverse_links.map((l, i) => (
                    <span key={l.path}>
                      {i > 0 && ' · '}
                      <button
                        onClick={() => onOpenPost(l.path)}
                        title={stripMarkdownLinks(l.insertedInto)}
                        className="text-brand-navy underline hover:text-brand-cyan"
                      >
                        {l.anchorText || l.slug}
                      </button>
                    </span>
                  ))}
                </p>
              )}

              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {idea.status === 'drafted' && idea.draft_path ? (
                  <>
                    <button
                      onClick={() => onOpenPost(idea.draft_path!)}
                      className="rounded-pill bg-brand-navy px-3.5 py-1.5 text-xs font-heading font-semibold text-white hover:opacity-90 transition-colors"
                    >
                      Open draft
                    </button>
                    {socialBusy.has(idea.id) && !idea.social_path ? (
                      <span className="text-xs font-body text-info">Generating social…</span>
                    ) : idea.social_path ? (
                      <>
                        <button
                          onClick={() => onOpenPost(idea.social_path!)}
                          className="rounded-pill border border-brand-navy px-3.5 py-1.5 text-xs font-heading font-semibold text-brand-navy hover:bg-brand-navy/5 transition-colors"
                        >
                          View social
                        </button>
                        <button
                          onClick={() => void generateSocial(idea.id)}
                          className="text-[11px] font-heading font-semibold text-text-muted hover:text-text-secondary transition-colors"
                        >
                          Regenerate social
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => void generateSocial(idea.id)}
                        className="rounded-pill border border-brand-navy px-3.5 py-1.5 text-xs font-heading font-semibold text-brand-navy hover:bg-brand-navy/5 transition-colors"
                      >
                        Generate social
                      </button>
                    )}
                  </>
                ) : idea.draft_status === 'running' ? (
                  <span className="text-xs font-body text-info">Drafting post…</span>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        if (notesFor === idea.id) {
                          setNotesFor(null)
                        } else {
                          setNotesFor(idea.id)
                          setNotesText('')
                        }
                      }}
                      className="rounded-pill bg-brand-cyan px-3.5 py-1.5 text-xs font-heading font-semibold text-white hover:opacity-90 transition-colors"
                    >
                      Draft post
                    </button>
                    {idea.status === 'suggested' && (
                      <button
                        onClick={() => void setStatus(idea.id, 'approved')}
                        className="rounded-pill border border-brand-navy px-3.5 py-1.5 text-xs font-heading font-semibold text-brand-navy hover:bg-brand-navy/5 transition-colors"
                      >
                        ★ Interested
                      </button>
                    )}
                    <button
                      onClick={() => void setStatus(idea.id, 'dismissed')}
                      title="Removes this idea — future brainstorms will avoid this territory"
                      className="rounded-pill px-3.5 py-1.5 text-xs font-heading font-semibold text-text-muted hover:text-error transition-colors"
                    >
                      Remove
                    </button>
                  </>
                )}
                {idea.draft_status === 'error' && (
                  <span className="text-xs font-body text-error">
                    Draft failed{idea.draft_error ? `: ${idea.draft_error}` : ''} — try again
                  </span>
                )}
              </div>

              {notesFor === idea.id && idea.draft_status !== 'running' && (
                <div className="mt-3 rounded border border-border-default bg-surface-default p-3">
                  <textarea
                    value={notesText}
                    onChange={(e) => setNotesText(e.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder="Optional notes for the writer — angle emphasis, must-mention items, CTA preference…"
                    className="w-full rounded border border-border-default px-3 py-2 text-xs font-body focus:border-brand-cyan focus:outline-none resize-y"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => void draft(idea.id, notesText.trim())}
                      className="rounded-pill bg-brand-navy px-3.5 py-1.5 text-xs font-heading font-semibold text-white hover:opacity-90 transition-colors"
                    >
                      Draft now
                    </button>
                    <button
                      onClick={() => {
                        setNotesFor(null)
                        setNotesText('')
                      }}
                      className="text-xs font-heading font-semibold text-text-muted hover:text-text-secondary transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

    </div>
  )
}
