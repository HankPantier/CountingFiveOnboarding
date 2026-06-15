'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'
import type { DraftCoverage } from '@/lib/session-draft/draft-from-audit'

interface DraftResponse {
  schemaData: SessionSchema
  gapList: GapItem[]
  contact?: { phone?: string; email?: string }
  coverage: DraftCoverage
}

const inputClass =
  'w-full rounded-lg border border-border-default bg-surface-card px-4 py-2.5 font-body text-sm text-text-primary focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/20'
const labelClass = 'block font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary'
const cardClass = 'rounded-lg border border-border-default bg-surface-card p-6 shadow-subtle'
const chip = 'inline-flex items-center rounded-full bg-surface-subtle px-2.5 py-0.5 text-xs font-body text-text-secondary'

export function StartSessionForm({ auditId }: { auditId: string }) {
  const router = useRouter()
  const [draft, setDraft] = useState<DraftResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [biz, setBiz] = useState({ name: '', tagline: '', customerDescription: '' })
  const [contact, setContact] = useState({ firstName: '', lastName: '', email: '', phone: '' })

  useEffect(() => {
    let cancelled = false
    const draftSession = async () => {
      try {
        const res = await fetch(`/api/audits/${auditId}/draft-session`, { method: 'POST' })
        if (!res.ok) {
          const b = await res.json().catch(() => ({}))
          throw new Error(b.error ?? 'Could not draft the session')
        }
        const data: DraftResponse = await res.json()
        if (cancelled) return
        setDraft(data)
        setBiz({
          name: data.schemaData.business?.name ?? '',
          tagline: data.schemaData.business?.tagline ?? '',
          customerDescription: data.schemaData.business?.customerDescription ?? '',
        })
        setContact({ firstName: '', lastName: '', email: data.contact?.email ?? '', phone: data.contact?.phone ?? '' })
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not draft the session')
          setLoading(false)
        }
      }
    }
    draftSession()
    return () => {
      cancelled = true
    }
  }, [auditId])

  const rerun = async () => {
    await fetch(`/api/audits/${auditId}/run`, { method: 'POST' }).catch(() => {})
    router.push(`/admin/audits/${auditId}`)
  }

  const confirm = async () => {
    if (!draft) return
    setSubmitting(true)
    setError(null)
    try {
      const hasContact = contact.firstName || contact.lastName || contact.email || contact.phone
      const schemaData: SessionSchema = {
        ...draft.schemaData,
        business: {
          ...draft.schemaData.business!,
          name: biz.name,
          tagline: biz.tagline,
          customerDescription: biz.customerDescription,
        },
        ...(hasContact ? { contact } : {}),
      }
      const res = await fetch(`/api/audits/${auditId}/start-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaData, gapList: draft.gapList }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error ?? 'Failed to create session')
      }
      const { sessionId } = await res.json()
      router.push(`/admin/sessions/${sessionId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create session')
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className={`${cardClass} flex items-center gap-3`}>
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-cyan border-t-transparent" />
        <p className="font-body text-sm text-text-secondary">
          Drafting a business profile from the audit… this can take up to a minute.
        </p>
      </div>
    )
  }

  if (error && !draft) {
    return (
      <div className={cardClass}>
        <p className="font-body text-sm text-error">{error}</p>
        <button onClick={() => router.refresh()} className="mt-4 font-body text-sm text-brand-cyan hover:underline">
          Try again
        </button>
      </div>
    )
  }

  if (!draft) return null
  const s = draft.schemaData
  const { coverage } = draft

  return (
    <div className="space-y-5">
      {/* Data-quality notice */}
      {coverage.thin ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
          <p className="font-heading text-sm font-semibold text-warning-strong">Limited site data</p>
          <p className="mt-1 font-body text-sm text-text-secondary">
            This profile was AI-drafted from limited content ({coverage.reasons.join('; ')}). Review
            carefully, or re-run the audit on more pages for a richer draft.
          </p>
          <button onClick={rerun} className="mt-3 rounded-pill border border-border-strong px-4 py-2 font-heading text-sm font-semibold text-text-secondary hover:bg-surface-subtle">
            Re-run audit →
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-info/30 bg-info/5 p-3">
          <p className="font-body text-xs text-text-secondary">
            AI-drafted from website content ({coverage.pagesUsed} pages). Verify before creating —
            anything missing becomes a guided question during onboarding.
          </p>
        </div>
      )}

      {/* Editable business + contact */}
      <div className={cardClass}>
        <h2 className="font-heading text-lg font-semibold text-brand-navy">Business</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className={labelClass}>Business name</label>
            <input className={`mt-1.5 ${inputClass}`} value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Tagline</label>
            <input className={`mt-1.5 ${inputClass}`} value={biz.tagline} onChange={(e) => setBiz({ ...biz, tagline: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>What they do</label>
            <textarea rows={3} className={`mt-1.5 ${inputClass}`} value={biz.customerDescription} onChange={(e) => setBiz({ ...biz, customerDescription: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Website</label>
            <input className={`mt-1.5 ${inputClass} bg-surface-subtle`} value={s.websiteUrl ?? ''} readOnly />
          </div>
        </div>
      </div>

      <div className={cardClass}>
        <h2 className="font-heading text-lg font-semibold text-brand-navy">Client contact</h2>
        <p className="mt-1 font-body text-xs text-text-muted">Optional — the client confirms this during onboarding. Phone/email prefilled from the site if found.</p>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div><label className={labelClass}>First name</label><input className={`mt-1.5 ${inputClass}`} value={contact.firstName} onChange={(e) => setContact({ ...contact, firstName: e.target.value })} /></div>
          <div><label className={labelClass}>Last name</label><input className={`mt-1.5 ${inputClass}`} value={contact.lastName} onChange={(e) => setContact({ ...contact, lastName: e.target.value })} /></div>
          <div><label className={labelClass}>Email</label><input className={`mt-1.5 ${inputClass}`} value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></div>
          <div><label className={labelClass}>Phone</label><input className={`mt-1.5 ${inputClass}`} value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></div>
        </div>
      </div>

      {/* Read-only drafted lists */}
      <div className={cardClass}>
        <h2 className="font-heading text-lg font-semibold text-brand-navy">Drafted from the site</h2>
        <p className="mt-1 font-body text-xs text-text-muted">These carry into the session and are refined during onboarding.</p>
        <dl className="mt-4 space-y-3">
          <ReadRow label="Services" items={(s.services ?? []).map((x) => x.name)} />
          <ReadRow label="Industries / niches" items={(s.niches ?? []).map((x) => x.name)} />
          <ReadRow label="Locations" items={(s.locations ?? []).map((x) => [x.name, x.city, x.state].filter(Boolean).join(', '))} />
          <ReadRow label="Team" items={(s.team ?? []).map((x) => `${x.name}${x.title ? ` — ${x.title}` : ''}`)} />
          <ReadRow label="Social links" items={s.culture?.socialMediaChannels ?? []} />
          <div className="flex items-baseline justify-between gap-4 border-t border-border-default pt-3">
            <dt className="font-body text-sm text-text-secondary">Brand tone</dt>
            <dd className="font-heading text-sm font-semibold text-text-primary">{s.brand?.currentTone || '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-body text-sm text-text-secondary">Open questions for onboarding</dt>
            <dd className="font-heading text-sm font-semibold text-text-primary">{draft.gapList.length} gaps</dd>
          </div>
        </dl>
      </div>

      {/* Content plan derived from the audit crawl */}
      <div className={cardClass}>
        <h2 className="font-heading text-lg font-semibold text-brand-navy">Content plan from audit</h2>
        <p className="mt-1 font-body text-xs text-text-muted">
          Pre-fills the content build — the audit&apos;s pages, rewrite candidates, and redirects carry
          into the content step. Add new strategic pages during onboarding.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { label: 'Pages found', value: coverage.contentPlan.pagesFound },
            { label: 'To rewrite', value: coverage.contentPlan.rewriteCandidates },
            { label: 'Redirects', value: coverage.contentPlan.redirects },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-border-default bg-surface-page px-4 py-3 text-center">
              <div className="font-heading text-xl font-bold text-brand-navy">{m.value}</div>
              <div className="font-body text-xs text-text-muted">{m.label}</div>
            </div>
          ))}
        </div>
        {(s.content_gaps?.authorityGaps?.length || s.content_gaps?.conversionGaps?.length) ? (
          <ul className="mt-4 space-y-1.5">
            {[...(s.content_gaps?.conversionGaps ?? []), ...(s.content_gaps?.authorityGaps ?? [])]
              .slice(0, 8)
              .map((g, i) => (
                <li key={i} className="flex items-start gap-2 font-body text-sm text-text-secondary">
                  <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                  <span>{g}</span>
                </li>
              ))}
          </ul>
        ) : null}
      </div>

      {error && <p className="rounded-lg bg-error/10 px-4 py-2 font-body text-sm text-error">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={confirm}
          disabled={submitting || !biz.name.trim()}
          className="rounded-pill bg-brand-cyan px-6 py-3 font-heading text-sm font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Creating session…' : 'Create session'}
        </button>
        <button
          onClick={() => router.push(`/admin/audits/${auditId}`)}
          className="font-body text-sm text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function ReadRow({ label, items }: { label: string; items: string[] }) {
  const clean = items.filter(Boolean)
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border-default pt-3 first:border-0 first:pt-0">
      <dt className="font-body text-sm text-text-secondary">{label}</dt>
      <dd className="flex flex-wrap justify-end gap-1.5">
        {clean.length ? clean.map((c, i) => <span key={i} className={chip}>{c}</span>) : <span className="font-body text-sm text-text-muted">—</span>}
      </dd>
    </div>
  )
}
