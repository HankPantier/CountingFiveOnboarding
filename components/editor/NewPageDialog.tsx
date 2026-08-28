'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// Mirror the server's slug normalization (create-page route) closely enough
// for a live preview: lowercase, keep a-z0-9 and '/', spaces → hyphens.
function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/\s-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^[/-]+|[/-]+$/g, '')
}

type Phase = 'form' | 'generating' | 'error'
type PageType = 'standard' | 'plans' | 'calculator'

const MAX_BRIEF = 500

const PRICING_COPY: Record<Exclude<PageType, 'standard'>, { url: string; label: string; blurb: string }> = {
  plans: {
    url: '/pricing',
    label: 'Pricing plans page',
    blurb:
      'A tiered plans page with feature cards, a monthly/annual toggle, and add-ons. We seed it from the firm’s pricing (and anything the audit found on their current site), then you refine the numbers.',
  },
  calculator: {
    url: '/pricing-calculator',
    label: 'Pricing calculator page',
    blurb:
      'An interactive estimate: visitors pick services and options for a ballpark monthly figure. We seed it from the firm’s pricing, then you refine the rates.',
  },
}

export default function NewPageDialog({
  sessionId,
  onClose,
  onCreated,
  onGenerated,
}: {
  sessionId: string
  onClose: () => void
  // Called once the starter file exists on the draft branch — select it.
  onCreated: (path: string) => void
  // Called when the AI first draft finishes — reload the file to show it.
  onGenerated: (path: string) => void
}) {
  const router = useRouter()
  const [pageType, setPageType] = useState<PageType>('standard')
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [mode, setMode] = useState<'blank' | 'ai'>('blank')
  const [brief, setBrief] = useState('')
  const [addToNav, setAddToNav] = useState(true)
  const [phase, setPhase] = useState<Phase>('form')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const effectiveSlug = slugEdited ? slugify(slug) : slugify(title)
  const urlPreview = effectiveSlug ? `/${effectiveSlug}` : ''

  const pollUntilDone = async (genId: string, path: string) => {
    // Poll the generation status; reload the page when the draft lands.
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      let data: { generation?: { status: string; error?: string | null } }
      try {
        const res = await fetch(`/api/edit/${sessionId}/create-page/${genId}`)
        if (!res.ok) continue
        data = (await res.json()) as typeof data
      } catch {
        continue
      }
      const status = data.generation?.status
      if (status === 'complete') {
        onGenerated(path)
        onClose()
        return
      }
      if (status === 'error') {
        setPhase('error')
        setError(
          data.generation?.error ??
            'The AI draft failed. The blank page was kept — you can edit it directly or try the AI editor.'
        )
        return
      }
    }
    // Timed out waiting — leave the starter in place; the admin can reload.
    setPhase('error')
    setError('The AI draft is taking longer than expected. Check back shortly, or edit the page directly.')
  }

  // Config-driven pricing pages: enable + push the config to the draft branch,
  // then drop the operator into the pricing editor to refine the numbers.
  const submitPricing = async (kind: Exclude<PageType, 'standard'>) => {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/edit/${sessionId}/create-pricing-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      })
      const data = (await res.json()) as { url?: string; editorPath?: string; error?: string }
      if (!res.ok || !data.editorPath) {
        setError(data.error ?? `Could not add the page (${res.status}).`)
        setBusy(false)
        return
      }
      // The page is staged on the draft; go refine the numbers, then publish.
      router.push(data.editorPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the page.')
      setBusy(false)
    }
  }

  const submit = async () => {
    if (pageType !== 'standard') {
      void submitPricing(pageType)
      return
    }
    setError(null)
    if (!title.trim()) {
      setError('Enter a page title.')
      return
    }
    if (!effectiveSlug) {
      setError('Enter a valid slug (letters, numbers, and hyphens).')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/edit/${sessionId}/create-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          slug: effectiveSlug,
          addToNav,
          mode,
          brief: mode === 'ai' ? brief.trim() : undefined,
        }),
      })
      const data = (await res.json()) as {
        path?: string
        url?: string
        generationId?: string
        error?: string
        generationError?: string
      }
      if (!res.ok || !data.path) {
        setError(data.error ?? `Could not create the page (${res.status}).`)
        setBusy(false)
        return
      }

      onCreated(data.path)

      if (mode === 'ai' && data.generationId) {
        setPhase('generating')
        setBusy(false)
        void pollUntilDone(data.generationId, data.path)
        return
      }
      if (data.generationError) {
        setError(`Page created, but the AI draft could not start: ${data.generationError}`)
        setPhase('error')
        setBusy(false)
        return
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the page.')
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create a new page"
    >
      <div className="w-full max-w-md rounded-xl border border-border-default bg-surface-card p-6 shadow-elevated">
        <h2 className="font-heading text-lg font-semibold text-brand-navy">New page</h2>

        {phase === 'generating' ? (
          <div className="mt-4">
            <p className="font-body text-sm text-text-primary">
              Writing <strong>{urlPreview}</strong> with AI, grounded in this client&apos;s business
              profile. This usually takes a minute.
            </p>
            <p className="mt-2 font-body text-xs text-text-muted">
              The blank page is already in place — you can keep working. It will refresh here when the
              draft is ready.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-pill border border-brand-navy px-4 py-1.5 font-heading text-xs font-semibold text-brand-navy transition-colors hover:bg-brand-navy/5"
              >
                Run in background
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 space-y-4">
              <fieldset>
                <span className="font-heading text-xs font-semibold text-text-secondary">Page type</span>
                <div className="mt-1.5 space-y-1.5">
                  {([
                    ['standard', 'Standard page', 'A normal content page you write yourself or with AI.'],
                    ['plans', PRICING_COPY.plans.label, 'Tiered plan cards with pricing — configured, not written.'],
                    ['calculator', PRICING_COPY.calculator.label, 'An interactive cost estimate — configured, not written.'],
                  ] as const).map(([value, label, hint]) => (
                    <label key={value} className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="pageType"
                        checked={pageType === value}
                        onChange={() => setPageType(value)}
                        className="mt-0.5 accent-brand-cyan"
                      />
                      <span className="font-body text-sm text-text-primary">
                        {label}
                        <span className="block text-xs text-text-muted">{hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {pageType !== 'standard' ? (
                <div className="rounded-lg border border-border-default bg-surface-subtle px-3 py-2.5">
                  <p className="font-body text-sm text-text-primary">{PRICING_COPY[pageType].blurb}</p>
                  <p className="mt-2 font-body text-xs text-text-muted">
                    Adds <span className="text-brand-navy">{PRICING_COPY[pageType].url}</span> to the draft and
                    opens its editor so you can review the numbers. Publish when you&apos;re ready.
                  </p>
                </div>
              ) : (
              <>
              <label className="block">
                <span className="font-heading text-xs font-semibold text-text-secondary">Title</span>
                <input
                  ref={titleRef}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Virtual CFO Services"
                  maxLength={120}
                  className="mt-1 w-full rounded-lg border border-border-default bg-surface-default px-3 py-2 font-body text-sm text-text-primary focus:border-brand-cyan focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="font-heading text-xs font-semibold text-text-secondary">
                  URL slug
                </span>
                <input
                  value={slugEdited ? slug : effectiveSlug}
                  onChange={(e) => {
                    setSlugEdited(true)
                    setSlug(e.target.value)
                  }}
                  placeholder="virtual-cfo-services"
                  className="mt-1 w-full rounded-lg border border-border-default bg-surface-default px-3 py-2 font-body text-sm text-text-primary focus:border-brand-cyan focus:outline-none"
                />
                <span className="mt-1 block font-body text-xs text-text-muted">
                  {urlPreview ? (
                    <>
                      Page URL: <span className="text-brand-navy">{urlPreview}</span> · use “/” to nest
                      (e.g. services/tax)
                    </>
                  ) : (
                    'Use “/” to nest under a parent, e.g. services/tax'
                  )}
                </span>
              </label>

              <fieldset>
                <span className="font-heading text-xs font-semibold text-text-secondary">
                  Starting point
                </span>
                <div className="mt-1.5 space-y-1.5">
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="mode"
                      checked={mode === 'blank'}
                      onChange={() => setMode('blank')}
                      className="mt-0.5 accent-brand-cyan"
                    />
                    <span className="font-body text-sm text-text-primary">
                      Start blank
                      <span className="block text-xs text-text-muted">
                        A minimal page you fill in yourself or with the AI editor.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="mode"
                      checked={mode === 'ai'}
                      onChange={() => setMode('ai')}
                      className="mt-0.5 accent-brand-cyan"
                    />
                    <span className="font-body text-sm text-text-primary">
                      AI first draft
                      <span className="block text-xs text-text-muted">
                        A full draft written from the client&apos;s business profile and your brief.
                      </span>
                    </span>
                  </label>
                </div>
              </fieldset>

              {mode === 'ai' && (
                <label className="block">
                  <span className="font-heading text-xs font-semibold text-text-secondary">
                    Brief <span className="font-normal text-text-muted">(optional)</span>
                  </span>
                  <textarea
                    value={brief}
                    onChange={(e) => setBrief(e.target.value.slice(0, MAX_BRIEF))}
                    rows={3}
                    placeholder="What should this page cover? Who is it for? Any key services, offers, or angles to hit."
                    className="mt-1 w-full resize-y rounded-lg border border-border-default bg-surface-default px-3 py-2 font-body text-sm text-text-primary focus:border-brand-cyan focus:outline-none"
                  />
                  <span className="mt-1 block text-right font-body text-xs text-text-muted">
                    {brief.length}/{MAX_BRIEF}
                  </span>
                </label>
              )}

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={addToNav}
                  onChange={(e) => setAddToNav(e.target.checked)}
                  className="accent-brand-cyan"
                />
                <span className="font-body text-sm text-text-primary">Add to main navigation</span>
              </label>
              </>
              )}
            </div>

            {error && (
              <p className="mt-3 font-body text-xs text-warning-strong" role="alert">
                {error}
              </p>
            )}

            <p className="mt-4 font-body text-xs text-text-muted">
              New pages and nav changes go live when you Publish and the site rebuilds.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-pill border border-brand-navy px-4 py-1.5 font-heading text-xs font-semibold text-brand-navy transition-colors hover:bg-brand-navy/5 disabled:opacity-50"
              >
                {phase === 'error' ? 'Close' : 'Cancel'}
              </button>
              {phase !== 'error' && (
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy || (pageType === 'standard' && !title.trim())}
                  className="rounded-pill bg-brand-cyan px-4 py-1.5 font-heading text-xs font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy
                    ? pageType === 'standard'
                      ? 'Creating…'
                      : 'Adding…'
                    : pageType === 'plans'
                      ? 'Add pricing page'
                      : pageType === 'calculator'
                        ? 'Add calculator page'
                        : mode === 'ai'
                          ? 'Create & draft'
                          : 'Create page'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
