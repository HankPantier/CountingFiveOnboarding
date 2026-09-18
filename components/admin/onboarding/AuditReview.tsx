'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { slugify } from '@/lib/content/sitemap-utils'
import AuditReviewItemRow, { type Treatment, type Signal, type ParentOption, type ItemSuggestion, type Confidence } from './AuditReviewItemRow'
import TeamReviewList, { type ReviewTeamMember, type TeamReviewPayload } from './TeamReviewList'
import GeoScopeControl, { type ReviewArea, type GeoScope, type GeoPayload } from './GeoScopeControl'
import CallNotesBox from './CallNotesBox'

export type ReviewItem = {
  name: string
  origin: 'site' | 'audit'
  note?: string
  signal?: Signal
  // Prior decision (re-visit); falls back to the AI suggestion, then an
  // origin-based default when absent.
  treatment?: Treatment
  parent?: string
  // The AI's pre-selected recommendation + rationale (from _meta.audit_suggestions).
  suggestion?: ItemSuggestion
}
export type ReviewSubGroup = {
  niche: string
  subs: { name: string; origin: 'site' | 'audit'; treatment?: Treatment; suggestion?: ItemSuggestion }[]
}

type Decision = { treatment: Treatment; parent?: string }
const subKey = (niche: string, name: string) => `${niche}::${name}`

// The structured first onboarding step. Reviews the audit's findings across four
// areas — each split into "On your current site" vs "Recommended from the audit"
// — and forces a per-item Own page / Content block / Exclude decision, then posts
// the whole thing atomically to /api/sessions/[id]/audit-review.
export default function AuditReview({
  sessionId,
  services,
  niches,
  subGroups,
  team,
  geo,
  initialCallNotes,
}: {
  sessionId: string
  services: ReviewItem[]
  niches: ReviewItem[]
  subGroups: ReviewSubGroup[]
  team: ReviewTeamMember[]
  geo: { scope?: GeoScope; areas: ReviewArea[]; suggestedScope?: GeoScope; suggestedPrimaryArea?: string; suggestionRationale?: string; suggestionConfidence?: Confidence }
  initialCallNotes: string
}) {
  const router = useRouter()
  // Existing site items default to their own page; audit recommendations default
  // to Exclude so the operator opts them in deliberately.
  const [serviceDec, setServiceDec] = useState<Record<string, Decision>>(() =>
    Object.fromEntries(services.map((s) => [s.name, { treatment: s.treatment ?? (s.origin === 'audit' ? 'exclude' : 'page'), parent: s.parent } as Decision])),
  )
  const [nicheDec, setNicheDec] = useState<Record<string, Decision>>(() =>
    Object.fromEntries(niches.map((n) => [n.name, { treatment: n.treatment ?? (n.origin === 'audit' ? 'exclude' : 'page'), parent: n.parent } as Decision])),
  )
  // Sub-services default to a block on their niche page (existing) or Exclude (audit).
  const [subDec, setSubDec] = useState<Record<string, Treatment>>(() =>
    Object.fromEntries(
      subGroups.flatMap((g) => g.subs.map((s) => [subKey(g.niche, s.name), s.treatment ?? (s.origin === 'audit' ? 'exclude' : 'block' as Treatment)])),
    ),
  )
  const [geoPayload, setGeoPayload] = useState<GeoPayload>({ scope: geo.scope ?? geo.suggestedScope ?? (geo.areas.length ? 'local' : 'national'), areas: geo.areas })
  const [teamPayload, setTeamPayload] = useState<TeamReviewPayload>({ keep: team.map((m) => m.name), remove: [], add: [] })
  const [callNotes, setCallNotes] = useState(initialCallNotes)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const setService = (name: string, patch: Partial<Decision>) =>
    setServiceDec((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  const setNiche = (name: string, patch: Partial<Decision>) =>
    setNicheDec((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))

  // Parent-page options for a block item = the sibling items currently set to
  // their own page, plus the category hub. Recomputed as decisions change.
  const serviceParents = useMemo<ParentOption[]>(() => {
    const opts = services
      .filter((s) => serviceDec[s.name]?.treatment === 'page')
      .map((s) => ({ value: `/services/${slugify(s.name)}`, label: s.name }))
    return [{ value: '/services', label: 'Services hub page' }, ...opts]
  }, [services, serviceDec])
  const nicheParents = useMemo<ParentOption[]>(() => {
    const opts = niches
      .filter((n) => nicheDec[n.name]?.treatment === 'page')
      .map((n) => ({ value: `/industries/${slugify(n.name)}`, label: n.name }))
    return [{ value: '/industries', label: 'Industries hub page' }, ...opts]
  }, [niches, nicheDec])

  const sitePart = <T extends ReviewItem>(items: T[]) => items.filter((i) => i.origin !== 'audit')
  const auditPart = <T extends ReviewItem>(items: T[]) => items.filter((i) => i.origin === 'audit')

  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const payload = {
        callNotes,
        niches: niches.map((n) => ({
          name: n.name,
          pageTreatment: nicheDec[n.name]?.treatment ?? 'page',
          origin: n.origin,
          ...(nicheDec[n.name]?.parent ? { parent: nicheDec[n.name]!.parent } : {}),
        })),
        services: services.map((s) => ({
          name: s.name,
          pageTreatment: serviceDec[s.name]?.treatment ?? 'page',
          origin: s.origin,
          ...(serviceDec[s.name]?.parent ? { parent: serviceDec[s.name]!.parent } : {}),
        })),
        subcategories: subGroups.flatMap((g) =>
          // Skip subs whose niche the operator excluded — nothing to attach them to.
          nicheDec[g.niche]?.treatment === 'exclude'
            ? []
            : g.subs.map((s) => ({
                niche: g.niche,
                name: s.name,
                pageTreatment: subDec[subKey(g.niche, s.name)] ?? 'block',
                origin: s.origin,
              })),
        ),
        geo: geoPayload,
        team: teamPayload,
      }
      const res = await fetch(`/api/sessions/${sessionId}/audit-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b?.error ?? `HTTP ${res.status}`)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the review')
      setSubmitting(false)
    }
  }

  const renderItemArea = (
    items: ReviewItem[],
    dec: Record<string, Decision>,
    set: (name: string, patch: Partial<Decision>) => void,
    parents: ParentOption[],
  ) => {
    const site = sitePart(items)
    const audit = auditPart(items)
    return (
      <div className="space-y-4">
        <Batch title="On your current site" empty="Nothing detected on the current site.">
          {site.map((it) => (
            <AuditReviewItemRow
              key={it.name}
              name={it.name}
              note={it.note}
              signal={it.signal}
              treatment={dec[it.name]?.treatment ?? 'page'}
              parent={dec[it.name]?.parent}
              parentOptions={parents}
              onTreatment={(t) => set(it.name, { treatment: t })}
              onParent={(p) => set(it.name, { parent: p })}
              suggestion={it.suggestion}
            />
          ))}
        </Batch>
        <Batch title="Recommended from the audit" empty="The audit didn’t recommend new additions here.">
          {audit.map((it) => (
            <AuditReviewItemRow
              key={it.name}
              name={it.name}
              note={it.note}
              signal={it.signal}
              treatment={dec[it.name]?.treatment ?? 'exclude'}
              parent={dec[it.name]?.parent}
              parentOptions={parents}
              onTreatment={(t) => set(it.name, { treatment: t })}
              onParent={(p) => set(it.name, { parent: p })}
              suggestion={it.suggestion}
            />
          ))}
        </Batch>
      </div>
    )
  }

  const visibleSubGroups = subGroups.filter((g) => nicheDec[g.niche]?.treatment !== 'exclude' && g.subs.length > 0)

  // Live consequence preview: what the current decisions produce (#4).
  const summary = useMemo(() => {
    let pages = 0, blocks = 0, excluded = 0, orphans = 0
    const add = (t: Treatment, parent: string | undefined, canOrphan: boolean) => {
      if (t === 'page') pages++
      else if (t === 'block') { blocks++; if (canOrphan && !parent) orphans++ }
      else excluded++
    }
    // Fallbacks mirror the state initializers' origin-aware defaults, so the live
    // totals never disagree with the pre-selected rows (site → page, audit → exclude).
    services.forEach((s) => add(serviceDec[s.name]?.treatment ?? (s.origin === 'audit' ? 'exclude' : 'page'), serviceDec[s.name]?.parent, true))
    niches.forEach((n) => add(nicheDec[n.name]?.treatment ?? (n.origin === 'audit' ? 'exclude' : 'page'), nicheDec[n.name]?.parent, true))
    visibleSubGroups.forEach((g) => g.subs.forEach((s) => add(subDec[subKey(g.niche, s.name)] ?? (s.origin === 'audit' ? 'exclude' : 'block'), undefined, false)))
    return { pages, blocks, excluded, orphans }
  }, [services, niches, serviceDec, nicheDec, subDec, visibleSubGroups])

  // Bulk actions (#4): fast paths so the operator confirms in one click.
  const acceptAllSuggestions = () => {
    setServiceDec((prev) => Object.fromEntries(services.map((s) => [s.name, s.suggestion ? { treatment: s.suggestion.treatment, parent: s.suggestion.parent } : prev[s.name]])))
    setNicheDec((prev) => Object.fromEntries(niches.map((n) => [n.name, n.suggestion ? { treatment: n.suggestion.treatment, parent: n.suggestion.parent } : prev[n.name]])))
    setSubDec((prev) => {
      const next = { ...prev }
      subGroups.forEach((g) => g.subs.forEach((s) => { if (s.suggestion) next[subKey(g.niche, s.name)] = s.suggestion.treatment }))
      return next
    })
  }
  const allSiteItemsToPages = () => {
    setServiceDec((prev) => Object.fromEntries(services.map((s) => [s.name, s.origin === 'site' ? { treatment: 'page' } : prev[s.name]])))
    setNicheDec((prev) => Object.fromEntries(niches.map((n) => [n.name, n.origin === 'site' ? { treatment: 'page' } : prev[n.name]])))
  }
  const excludeWeakNiches = () => {
    setNicheDec((prev) => Object.fromEntries(niches.map((n) => [n.name, n.signal === 'weak' ? { treatment: 'exclude' } : prev[n.name]])))
  }
  const hasWeakNiche = niches.some((n) => n.signal === 'weak')
  const hasSuggestions = services.some((s) => s.suggestion) || niches.some((n) => n.suggestion)

  return (
    <div className="space-y-8">
      <div className="sticky top-0 z-10 rounded-xl border border-brand-cyan/30 bg-surface-card/95 backdrop-blur px-4 py-3 shadow-subtle">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-body text-text-primary flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-heading font-semibold text-brand-navy">You’re building:</span>
            <span><span className="font-heading font-semibold">{summary.pages}</span> page{summary.pages === 1 ? '' : 's'}</span>
            <span className="text-text-muted">·</span>
            <span><span className="font-heading font-semibold">{summary.blocks}</span> section{summary.blocks === 1 ? '' : 's'}</span>
            <span className="text-text-muted">·</span>
            <span className="text-text-muted">{summary.excluded} excluded</span>
            {summary.orphans > 0 && (
              <span className="inline-flex items-center rounded-pill border border-warning/40 bg-warning/10 text-warning px-2 py-0.5 text-[11px] font-heading font-semibold">
                {summary.orphans} block{summary.orphans === 1 ? '' : 's'} need a parent page
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasSuggestions && <BulkButton onClick={acceptAllSuggestions}>Accept all AI suggestions</BulkButton>}
            <BulkButton onClick={allSiteItemsToPages}>Site items → own pages</BulkButton>
            {hasWeakNiche && <BulkButton onClick={excludeWeakNiches}>Exclude weak-signal industries</BulkButton>}
          </div>
        </div>
      </div>

      <Section title="Services" subtitle="Confirm the services for the new site. Choose a page, fold it into a parent page as a content block, or exclude it.">
        {renderItemArea(services, serviceDec, setService, serviceParents)}
      </Section>

      <Section title="Industries & niches" subtitle="Confirm the specialties you serve and the opportunities the audit surfaced.">
        {renderItemArea(niches, nicheDec, setNiche, nicheParents)}
      </Section>

      {visibleSubGroups.length > 0 && (
        <Section title="Sub-services" subtitle="Under each kept industry — promote a sub-service to its own page, keep it as a section on the industry page, or exclude it.">
          <div className="space-y-4">
            {visibleSubGroups.map((g) => (
              <div key={g.niche}>
                <p className="text-xs font-heading font-semibold text-brand-navy mb-1.5">{g.niche}</p>
                <div className="space-y-2">
                  {g.subs.map((s) => (
                    <AuditReviewItemRow
                      key={s.name}
                      name={s.name}
                      treatment={subDec[subKey(g.niche, s.name)] ?? (s.origin === 'audit' ? 'exclude' : 'block')}
                      onTreatment={(t) => setSubDec((prev) => ({ ...prev, [subKey(g.niche, s.name)]: t }))}
                      suggestion={s.suggestion}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Geographic scope" subtitle="How local is the firm, and which areas matter for search.">
        <GeoScopeControl
          initialScope={geo.scope ?? geo.suggestedScope}
          initialAreas={geo.areas}
          onChange={setGeoPayload}
          suggestedScope={geo.suggestedScope}
          suggestedPrimaryArea={geo.suggestedPrimaryArea}
          suggestionRationale={geo.suggestionRationale}
          suggestionConfidence={geo.suggestionConfidence}
        />
      </Section>

      <Section title="Team" subtitle="Confirm who’s on the new site. Remove anyone who’s left; add anyone missing.">
        <TeamReviewList members={team} onChange={setTeamPayload} />
      </Section>

      <Section title="Call notes" subtitle="Anything the structured decisions above don’t capture.">
        <CallNotesBox value={callNotes} onChange={setCallNotes} />
      </Section>

      {error && <p className="text-error text-sm font-body">{error}</p>}
      <div className="flex items-center justify-end gap-3 border-t border-border-default pt-4">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-6 py-2.5 rounded-pill shadow-cyan-base transition-all duration-150 hover:-translate-y-px hover:bg-brand-cyan-dark hover:shadow-cyan-glow active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Saving…' : 'Save review & continue →'}
        </button>
      </div>
    </div>
  )
}

function BulkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border border-border-default text-text-secondary font-heading font-semibold text-xs px-3 py-1.5 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy"
    >
      {children}
    </button>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border-default bg-surface-card p-5 shadow-subtle">
      <h2 className="text-base font-heading font-semibold text-brand-navy">{title}</h2>
      <p className="text-text-secondary text-xs font-body mt-0.5 mb-4">{subtitle}</p>
      {children}
    </section>
  )
}

function Batch({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children]
  const hasItems = items.some(Boolean) && items.flat().filter(Boolean).length > 0
  return (
    <div>
      <p className="text-[11px] font-heading font-semibold text-text-muted uppercase tracking-wide mb-2">{title}</p>
      {hasItems ? <div className="space-y-2">{children}</div> : <p className="text-text-muted text-xs font-body italic">{empty}</p>}
    </div>
  )
}
