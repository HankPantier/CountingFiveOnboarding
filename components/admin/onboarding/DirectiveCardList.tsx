'use client'
import { useState } from 'react'
import type { OperatorDirective, OperatorDirectiveKind } from '@/types/session-schema'
import { needsSnapshot, resolveDirectiveStatus, type CrawledPageRef } from '@/lib/onboarding/directives'

const KIND_LABEL: Record<OperatorDirectiveKind, string> = {
  bring_page: 'Bring page over',
  verbatim_content: 'Keep verbatim',
  add_offering: 'Add new offering',
  merge_page: 'Merge page',
  drop_page: 'Drop page',
  other: 'Other instruction',
}
const KIND_ORDER = Object.keys(KIND_LABEL) as OperatorDirectiveKind[]

const selectCls =
  'border border-border-default rounded-lg px-2 py-1 text-xs font-body bg-surface-card focus:outline-none focus:border-brand-cyan max-w-full'

// The confirmable instruction cards the "Interpret" step produces. Each card is
// one typed directive the rep can correct (pickers point it at a real crawled
// page / team member) or remove. Status is recomputed locally on every edit with
// the same resolver the server uses; verbatim cards re-capture their snapshot
// from the live site when re-pointed.
export default function DirectiveCardList({
  sessionId,
  directives,
  onChange,
  pages,
  teamNames,
}: {
  sessionId: string
  directives: OperatorDirective[]
  onChange: (next: OperatorDirective[]) => void
  pages: CrawledPageRef[]
  teamNames: string[]
}) {
  const [capturing, setCapturing] = useState<Record<string, boolean>>({})
  const [captureError, setCaptureError] = useState<Record<string, string>>({})

  const replace = (id: string, next: OperatorDirective) =>
    onChange(directives.map((d) => (d.id === id ? next : d)))

  const edit = (d: OperatorDirective, patch: Partial<OperatorDirective>) => {
    const next: OperatorDirective = { ...d, ...patch }
    // A re-pointed verbatim card no longer matches its captured text.
    const repointed =
      ('sourceUrl' in patch && patch.sourceUrl !== d.sourceUrl) ||
      ('teamMember' in patch && patch.teamMember !== d.teamMember) ||
      ('kind' in patch && patch.kind !== d.kind)
    if (repointed) {
      delete next.snapshot
      delete next.verbatimText
    }
    next.status = resolveDirectiveStatus(next, pages, teamNames)
    replace(d.id, next)
  }

  async function capture(d: OperatorDirective) {
    setCapturing((c) => ({ ...c, [d.id]: true }))
    setCaptureError((e) => ({ ...e, [d.id]: '' }))
    try {
      const res = await fetch(`/api/sessions/${sessionId}/directives/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directive: d }),
      })
      const body = (await res.json().catch(() => ({}))) as { directive?: OperatorDirective; error?: string }
      if (!res.ok || !body.directive) throw new Error(body.error ?? `HTTP ${res.status}`)
      replace(d.id, body.directive)
      if (!body.directive.snapshot) setCaptureError((e) => ({ ...e, [d.id]: 'Couldn’t read that page on the live site.' }))
      else if (d.kind === 'verbatim_content' && !body.directive.verbatimText) {
        setCaptureError((e) => ({ ...e, [d.id]: 'Couldn’t find that exact text on the page.' }))
      }
    } catch (err) {
      setCaptureError((e) => ({ ...e, [d.id]: err instanceof Error ? err.message : 'Capture failed' }))
    } finally {
      setCapturing((c) => ({ ...c, [d.id]: false }))
    }
  }

  if (!directives.length) return null

  const pageSelect = (value: string | undefined, onPick: (url: string) => void, placeholder: string) => (
    <select value={value ?? ''} onChange={(e) => onPick(e.target.value)} className={selectCls}>
      <option value="">{placeholder}</option>
      {pages.map((p) => (
        <option key={p.url} value={p.url}>
          {p.title} ({p.url})
        </option>
      ))}
    </select>
  )

  return (
    <div className="space-y-2.5">
      {directives.map((d) => {
        const resolved = d.status === 'resolved'
        return (
          <div
            key={d.id}
            className={`rounded-lg border px-3 py-2.5 bg-surface-page ${resolved ? 'border-border-default' : 'border-warning/50'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={d.kind}
                  onChange={(e) => edit(d, { kind: e.target.value as OperatorDirectiveKind })}
                  className="rounded-pill border border-brand-cyan/30 bg-brand-cyan/10 text-brand-navy px-2 py-0.5 text-[11px] font-heading font-semibold uppercase tracking-wide focus:outline-none"
                >
                  {KIND_ORDER.map((k) => (
                    <option key={k} value={k}>{KIND_LABEL[k]}</option>
                  ))}
                </select>
                {resolved ? (
                  <span className="inline-flex items-center rounded-pill border border-success/40 bg-success/10 text-success px-2 py-0.5 text-[11px] font-heading font-semibold">
                    ✓ Ready
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-pill border border-warning/40 bg-warning/10 text-warning px-2 py-0.5 text-[11px] font-heading font-semibold">
                    Needs a match: becomes a Q&amp;A question if left
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onChange(directives.filter((x) => x.id !== d.id))}
                aria-label="Remove instruction"
                className="text-text-muted hover:text-error text-sm font-heading font-semibold px-1"
              >
                ×
              </button>
            </div>

            <p className="mt-1.5 text-xs font-body text-text-secondary italic">“{d.sourceText}”</p>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-body text-text-secondary">
              {(d.kind === 'bring_page' || d.kind === 'drop_page') &&
                pageSelect(d.sourceUrl, (u) => edit(d, { sourceUrl: u || undefined }), 'Choose the page…')}

              {d.kind === 'bring_page' && (
                <>
                  <label className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={!!d.verbatim} onChange={(e) => edit(d, { verbatim: e.target.checked || undefined })} />
                    Keep wording verbatim
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={!!d.keepLinks} onChange={(e) => edit(d, { keepLinks: e.target.checked || undefined })} />
                    Keep all links
                  </label>
                </>
              )}

              {d.kind === 'merge_page' && (
                <>
                  {pageSelect(d.sourceUrl, (u) => edit(d, { sourceUrl: u || undefined }), 'Page to fold in…')}
                  <span aria-hidden>→</span>
                  {pageSelect(d.targetUrl, (u) => edit(d, { targetUrl: u || undefined }), 'Into page…')}
                </>
              )}

              {d.kind === 'verbatim_content' && (
                <>
                  <select
                    value={d.teamMember ?? ''}
                    onChange={(e) => edit(d, { teamMember: e.target.value || undefined })}
                    className={selectCls}
                  >
                    <option value="">Not a bio (a passage)</option>
                    {teamNames.map((n) => (
                      <option key={n} value={n}>Bio: {n}</option>
                    ))}
                  </select>
                  <span>from</span>
                  {pageSelect(d.sourceUrl, (u) => edit(d, { sourceUrl: u || undefined }), 'Page it’s on…')}
                </>
              )}

              {d.kind === 'add_offering' && (
                <>
                  <select
                    value={d.offering?.type ?? 'service'}
                    onChange={(e) => edit(d, { offering: { name: d.offering?.name ?? '', treatment: d.offering?.treatment ?? 'page', type: e.target.value === 'niche' ? 'niche' : 'service' } })}
                    className={selectCls}
                  >
                    <option value="service">Service</option>
                    <option value="niche">Industry</option>
                  </select>
                  <input
                    value={d.offering?.name ?? ''}
                    onChange={(e) => {
                      const name = e.target.value
                      edit(d, { offering: name.trim() ? { type: d.offering?.type ?? 'service', treatment: d.offering?.treatment ?? 'page', name } : undefined })
                    }}
                    placeholder="Name"
                    className="border border-border-default rounded-lg px-2 py-1 text-xs font-body bg-surface-card focus:outline-none focus:border-brand-cyan"
                  />
                  <select
                    value={d.offering?.treatment ?? 'page'}
                    disabled={!d.offering}
                    onChange={(e) => d.offering && edit(d, { offering: { ...d.offering, treatment: e.target.value === 'block' ? 'block' : 'page' } })}
                    className={selectCls}
                  >
                    <option value="page">Own page</option>
                    <option value="block">Section on the hub page</option>
                  </select>
                </>
              )}
            </div>

            {needsSnapshot(d) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-body">
                {d.snapshot ? (
                  <span className="text-text-muted">
                    Captured from the live site · {d.snapshot.words} words · {d.snapshot.links} link{d.snapshot.links === 1 ? '' : 's'}
                  </span>
                ) : (
                  <span className="text-warning">Not captured yet</span>
                )}
                {d.sourceUrl && (
                  <button
                    type="button"
                    onClick={() => capture(d)}
                    disabled={capturing[d.id]}
                    className="border border-border-default text-text-secondary font-heading font-semibold text-[11px] px-2.5 py-0.5 rounded-pill hover:border-brand-cyan hover:text-brand-navy disabled:opacity-50"
                  >
                    {capturing[d.id] ? 'Capturing…' : d.snapshot ? 'Re-capture' : 'Capture'}
                  </button>
                )}
                {captureError[d.id] && <span className="text-error">{captureError[d.id]}</span>}
                {!captureError[d.id] && d.kind === 'verbatim_content' && d.snapshot && !d.verbatimText && (
                  <span className="text-warning">
                    {d.teamMember ? `${d.teamMember}’s bio isn’t on this page.` : 'That exact text isn’t on this page.'} Pick the page it’s on, then Re-capture.
                  </span>
                )}
              </div>
            )}

            {d.kind === 'verbatim_content' && d.verbatimText && (
              <p className="mt-1.5 text-xs font-body text-text-secondary border-l-2 border-brand-cyan/40 pl-2 line-clamp-3 whitespace-pre-line">
                {d.verbatimText}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
