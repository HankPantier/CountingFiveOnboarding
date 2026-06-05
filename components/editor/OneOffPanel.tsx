'use client'

import { useCallback, useEffect, useState } from 'react'
import type { BrandFitResult } from '@/lib/content/brand-fit'
import BrandConflictCard from './BrandConflictCard'

type OneOffOption = { label: string; text: string }
type OneOffContext = { pageUrl?: string; teamMemberName?: string }

type Generation = {
  id: string
  prompt: string
  context: OneOffContext
  options: OneOffOption[]
  status: 'running' | 'complete' | 'error'
  error: string | null
  created_at: string
}

const POLL_MS = 5000
const OFF_BRAND_PREFIX = '[Approved off-brand direction]'

function displayPrompt(prompt: string): string {
  return prompt.startsWith(OFF_BRAND_PREFIX) ? prompt.slice(OFF_BRAND_PREFIX.length).trim() : prompt
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="shrink-0 rounded-[40px] border border-brand-navy px-3 py-1 text-[11px] font-heading font-semibold text-brand-navy hover:bg-brand-navy/5 transition-colors"
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  )
}

export default function OneOffPanel({ sessionId }: { sessionId: string }) {
  const [generations, setGenerations] = useState<Generation[]>([])
  const [loading, setLoading] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [brandConflict, setBrandConflict] = useState<{ prompt: string; fit: BrandFitResult } | null>(null)
  const [amending, setAmending] = useState(false)

  const refresh = useCallback(async (): Promise<Generation[]> => {
    const res = await fetch(`/api/edit/${sessionId}/resources/oneoff`)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error ?? `Failed to load history: ${res.status}`)
    }
    const data = (await res.json()) as { generations: Generation[] }
    setGenerations(data.generations)
    return data.generations
  }, [sessionId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load history'))
      .finally(() => setLoading(false))
  }, [refresh])

  const anyRunning = generations.some((g) => g.status === 'running')
  useEffect(() => {
    if (!anyRunning) return
    const timer = setInterval(() => {
      void refresh().catch(() => {})
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [anyRunning, refresh])

  const generate = async (text: string, overrideBrandFit = false) => {
    setError(null)
    setBrandConflict(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/edit/${sessionId}/resources/oneoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, overrideBrandFit }),
      })
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { brandFit?: BrandFitResult; error?: string }
        if (data.brandFit) {
          setBrandConflict({ prompt: text, fit: data.brandFit })
          return
        }
        throw new Error(data.error ?? 'Request conflicted')
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Generation failed: ${res.status}`)
      }
      setPrompt('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setSubmitting(false)
    }
  }

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
      await generate(brandConflict.prompt, true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Brand update failed')
    } finally {
      setAmending(false)
    }
  }

  const remove = async (genId: string) => {
    setError(null)
    try {
      const res = await fetch(`/api/edit/${sessionId}/resources/oneoff/${genId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Delete failed: ${res.status}`)
      }
      setGenerations((prev) => prev.filter((g) => g.id !== genId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="font-heading text-lg font-semibold text-brand-navy mb-1">One-off content</h2>
      <p className="text-xs font-body text-text-muted mb-4">
        Ask for anything client-specific — a LinkedIn bio for a team member, a new hero title for a
        page, a Google Business description. Generates three on-brand options grounded in what we
        know about this firm.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (prompt.trim() && !submitting) void generate(prompt.trim())
        }}
        className="mb-5"
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder='e.g. "Generate a new LinkedIn bio for Kelsey Korbey" or "Write a new hero title for the services page"'
          className="w-full rounded-lg border border-border-default bg-surface-card px-4 py-3 text-sm font-body text-text-primary placeholder:text-text-muted focus:border-brand-cyan focus:outline-none resize-y"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={submitting || !prompt.trim()}
            className="rounded-[40px] bg-brand-cyan px-5 py-2 text-sm font-heading font-semibold text-white hover:opacity-90 disabled:bg-surface-subtle disabled:text-text-muted transition-colors"
          >
            {submitting ? 'Starting…' : 'Generate options'}
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-4 rounded border border-error/30 bg-error/5 px-3 py-2 text-xs font-body text-error">
          {error}
        </div>
      )}

      {brandConflict && (
        <BrandConflictCard
          requestText={brandConflict.prompt}
          fit={brandConflict.fit}
          amending={amending}
          onRevise={() => {
            setPrompt(brandConflict.prompt)
            setBrandConflict(null)
          }}
          onProceed={() => void generate(brandConflict.prompt, true)}
          onAmendAndProceed={() => void amendAndProceed()}
        />
      )}

      {loading ? (
        <p className="text-sm font-body text-text-muted">Loading history…</p>
      ) : generations.length === 0 ? (
        <p className="text-sm font-body text-text-muted">
          Nothing generated yet — ask for something above.
        </p>
      ) : (
        <ul className="space-y-4">
          {generations.map((gen) => (
            <li key={gen.id} className="rounded-lg border border-border-default bg-surface-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-body text-text-primary">{displayPrompt(gen.prompt)}</p>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-body text-text-muted">{relativeTime(gen.created_at)}</span>
                    {gen.context?.teamMemberName && (
                      <span className="rounded-full bg-brand-cyan/10 px-2 py-0.5 text-[10px] font-body text-brand-navy">
                        {gen.context.teamMemberName}
                      </span>
                    )}
                    {gen.context?.pageUrl && (
                      <span className="rounded-full bg-brand-cyan/10 px-2 py-0.5 text-[10px] font-body text-brand-navy">
                        {gen.context.pageUrl}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => void remove(gen.id)}
                  className="shrink-0 text-[11px] font-heading font-semibold text-text-muted hover:text-error transition-colors"
                >
                  Delete
                </button>
              </div>

              {gen.status === 'running' && (
                <p className="mt-3 text-xs font-body text-info">Generating options…</p>
              )}
              {gen.status === 'error' && (
                <div className="mt-3 flex items-center gap-3">
                  <span className="text-xs font-body text-error">
                    Failed{gen.error ? `: ${gen.error}` : ''}
                  </span>
                  <button
                    onClick={() => void generate(displayPrompt(gen.prompt), gen.prompt.startsWith(OFF_BRAND_PREFIX))}
                    className="text-[11px] font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}
              {gen.status === 'complete' && gen.options.length > 0 && (
                <div className="mt-3 space-y-2">
                  {gen.options.map((opt, i) => (
                    <div
                      key={i}
                      className="flex items-start justify-between gap-3 rounded border border-border-default bg-surface-default p-3"
                    >
                      <div className="min-w-0">
                        <div className="text-[10px] font-heading font-semibold uppercase tracking-wide text-text-muted mb-1">
                          {opt.label}
                        </div>
                        <p className="text-xs font-body text-text-primary whitespace-pre-wrap">{opt.text}</p>
                      </div>
                      <CopyButton text={opt.text} />
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
