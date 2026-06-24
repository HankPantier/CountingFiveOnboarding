'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { RefinedBlogIdea } from '@/lib/content/blog-idea-refiner'

export type ClientOption = { id: string; websiteUrl: string; firmName: string | null }

const EMPTY_IDEA: RefinedBlogIdea = {
  title: '',
  angle: '',
  target_keyword: '',
  secondary_keywords: [],
  rationale: '',
  suggested_external_links: [],
}

export default function NewBatchFlow({ clients }: { clients: ClientOption[] }) {
  const router = useRouter()
  const [step, setStep] = useState<'ideate' | 'select'>('ideate')

  const [seed, setSeed] = useState('')
  const [instruction, setInstruction] = useState('')
  const [idea, setIdea] = useState<RefinedBlogIdea | null>(null)
  const [refining, setRefining] = useState(false)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function refine(withInstruction: boolean) {
    setError('')
    if (!seed.trim()) {
      setError('Enter a topic first')
      return
    }
    setRefining(true)
    try {
      const res = await fetch('/api/blog-batches/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed,
          current: withInstruction ? idea : undefined,
          instruction: withInstruction ? instruction : undefined,
        }),
      })
      const data = (await res.json()) as { idea?: RefinedBlogIdea; error?: string }
      if (!res.ok || !data.idea) {
        setError(data.error ?? 'Could not refine the idea')
        return
      }
      setIdea(data.idea)
      setInstruction('')
    } catch {
      setError('Network error — please try again')
    } finally {
      setRefining(false)
    }
  }

  function updateIdea<K extends keyof RefinedBlogIdea>(key: K, value: RefinedBlogIdea[K]) {
    setIdea((prev) => ({ ...(prev ?? EMPTY_IDEA), [key]: value }))
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function generate() {
    if (!idea?.title.trim() || selected.size === 0) return
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/blog-batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea, sessionIds: [...selected], seed }),
      })
      const data = (await res.json()) as { batchId?: string; error?: string }
      if (!res.ok || !data.batchId) {
        setError(data.error ?? 'Could not start the batch')
        setSubmitting(false)
        return
      }
      router.push(`/admin/blog-batch/${data.batchId}`)
    } catch {
      setError('Network error — please try again')
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full border border-border-default rounded-card px-3 py-2 text-sm font-body text-text-primary focus:outline-none focus:border-brand-cyan'

  return (
    <main className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-heading font-bold text-brand-navy">New Blog Batch</h1>
        <Link
          href="/admin/blog-batch"
          className="border border-border-default text-text-secondary font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy"
        >
          Cancel
        </Link>
      </div>

      {error && <p className="text-sm text-error bg-error/10 px-3 py-2 rounded-card mb-4">{error}</p>}

      {step === 'ideate' && (
        <div className="space-y-5">
          <div className="bg-surface-card border border-border-default rounded-lg p-5 shadow-subtle">
            <label className="block text-xs font-heading font-semibold text-brand-navy uppercase tracking-wide mb-2">
              1. Your topic
            </label>
            <textarea
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="e.g. R&amp;D tax credits for early-stage startups"
              className={inputCls}
            />
            <div className="mt-3">
              <button
                type="button"
                onClick={() => refine(false)}
                disabled={refining || !seed.trim()}
                className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {refining ? 'Refining…' : idea ? 'Regenerate' : 'Refine with AI'}
              </button>
            </div>
          </div>

          {idea && (
            <div className="bg-surface-card border border-border-default rounded-lg p-5 shadow-subtle space-y-4">
              <label className="block text-xs font-heading font-semibold text-brand-navy uppercase tracking-wide">
                2. Refined idea
              </label>
              <div>
                <span className="block text-xs font-body text-text-muted mb-1">Title</span>
                <input value={idea.title} onChange={(e) => updateIdea('title', e.target.value)} className={inputCls} />
              </div>
              <div>
                <span className="block text-xs font-body text-text-muted mb-1">Angle</span>
                <input value={idea.angle} onChange={(e) => updateIdea('angle', e.target.value)} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="block text-xs font-body text-text-muted mb-1">Primary keyword</span>
                  <input
                    value={idea.target_keyword}
                    onChange={(e) => updateIdea('target_keyword', e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <span className="block text-xs font-body text-text-muted mb-1">Secondary keywords (comma-separated)</span>
                  <input
                    value={idea.secondary_keywords.join(', ')}
                    onChange={(e) =>
                      updateIdea(
                        'secondary_keywords',
                        e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean)
                      )
                    }
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <span className="block text-xs font-body text-text-muted mb-1">Rationale</span>
                <textarea
                  value={idea.rationale}
                  onChange={(e) => updateIdea('rationale', e.target.value)}
                  rows={2}
                  className={inputCls}
                />
              </div>

              <div className="border-t border-border-default pt-4">
                <span className="block text-xs font-body text-text-muted mb-1">Refine further (optional)</span>
                <div className="flex gap-2">
                  <input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    maxLength={300}
                    placeholder="e.g. make it niche to restaurants"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => refine(true)}
                    disabled={refining || !instruction.trim()}
                    className="shrink-0 border border-border-default text-text-secondary font-heading font-semibold text-xs px-4 py-2 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {refining ? 'Refining…' : 'Refine again'}
                  </button>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep('select')}
                  disabled={!idea.title.trim()}
                  className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Lock idea &amp; choose clients &rarr;
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'select' && (
        <div className="bg-surface-card border border-border-default rounded-lg p-5 shadow-subtle">
          <div className="flex items-center justify-between mb-4">
            <label className="text-xs font-heading font-semibold text-brand-navy uppercase tracking-wide">
              3. Clients ({selected.size} selected)
            </label>
            <div className="flex gap-3 text-xs font-body">
              <button
                type="button"
                onClick={() => setSelected(new Set(clients.map((c) => c.id)))}
                className="text-brand-cyan hover:underline"
              >
                Select all
              </button>
              <button type="button" onClick={() => setSelected(new Set())} className="text-text-muted hover:underline">
                Clear
              </button>
            </div>
          </div>

          {clients.length === 0 ? (
            <p className="text-sm text-text-muted font-body py-6 text-center">
              No eligible clients. A client must have a published, repo-linked site to receive a drafted post.
            </p>
          ) : (
            <div className="border border-border-default rounded-card max-h-80 overflow-y-auto divide-y divide-border-default mb-4">
              {clients.map((c) => (
                <label key={c.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-subtle">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="accent-brand-cyan"
                  />
                  <span className="text-sm font-body text-text-primary truncate">{c.firmName ?? c.websiteUrl}</span>
                  {c.firmName && <span className="text-xs text-text-muted truncate">{c.websiteUrl}</span>}
                </label>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep('ideate')}
              className="border border-border-default text-text-secondary font-heading font-semibold text-xs px-5 py-3 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy"
            >
              &larr; Back to idea
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={submitting || selected.size === 0}
              className="flex-1 bg-brand-cyan text-text-inverse font-heading font-semibold text-xs py-3 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Starting…' : `Generate for ${selected.size} client${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
