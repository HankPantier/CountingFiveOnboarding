// Maps the audit's intelligence layer into the onboarding session seed so the
// chat starts pre-informed. Fills schema fields that previously only came from
// MBP parsing: niches, reputation, business.affiliations, and the reserved
// content_gaps.nicheGaps / teamExpertiseGaps buckets. Mutates the passed schema.
import type { AuditIntelligence } from '@/types/audit-result'
import type { SessionSchema } from '@/types/session-schema'

const PRESS_TYPE_RE = /press|award|article|interview|media/i

function dedup(values: Iterable<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const t = v.trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out
}

export function enrichSchemaFromIntelligence(
  schema: SessionSchema,
  intel: AuditIntelligence,
): void {
  const niche = intel.niche_services
  const di = intel.digital_intelligence

  // ── Niches: add detected niches the AI draft didn't already capture ─────────
  if (niche?.detected_niches?.length) {
    schema.niches ??= []
    const existing = new Set(schema.niches.map((n) => n.name.toLowerCase()))
    for (const d of niche.detected_niches) {
      if (d.name && !existing.has(d.name.toLowerCase())) {
        schema.niches.push({ name: d.name, description: d.note ?? '', icp: '', painPoints: '', valueProp: '' })
        existing.add(d.name.toLowerCase())
      }
    }
  }

  // ── Content gaps: fill the reserved niche / team-expertise buckets ──────────
  if (schema.content_gaps) {
    const nicheGaps = [
      ...schema.content_gaps.nicheGaps,
      ...(niche?.invisible_niches.map((n) => n.name) ?? []),
      ...(di?.niche_gap.external ?? []),
    ]
    schema.content_gaps.nicheGaps = dedup(nicheGaps)
    schema.content_gaps.teamExpertiseGaps = dedup([
      ...schema.content_gaps.teamExpertiseGaps,
      ...(di?.niche_gap.unleveraged ?? []),
    ])
  }

  if (!di) return

  // ── Reputation (audit-sourced, previously MBP-only) ─────────────────────────
  const rep = di.reputation
  const hasReputation =
    rep.sentiment || rep.ratings.length || rep.praise_themes.length || rep.concern_themes.length || di.content_footprint.length
  if (hasReputation) {
    const findRating = (kw: string) => rep.ratings.find((r) => r.toLowerCase().includes(kw))
    const reviewSummary = [rep.sentiment, rep.praise_themes.join(', ')].filter(Boolean).join(' — ')
    const pressAndMedia = di.content_footprint
      .filter((f) => PRESS_TYPE_RE.test(f.type))
      .map((f) => (f.source ? `${f.title} (${f.source})` : f.title))
      .filter(Boolean)
    schema.reputation = {
      googleRating: findRating('google'),
      yelpRating: findRating('yelp'),
      reviewSummary: reviewSummary || undefined,
      trustSignalGaps: dedup(rep.concern_themes),
      pressAndMedia: dedup(pressAndMedia),
    }
  }

  // ── Affiliations → business profile ─────────────────────────────────────────
  if (di.affiliations.length && schema.business) {
    schema.business.affiliations = dedup([...(schema.business.affiliations ?? []), ...di.affiliations])
  }

  // ── Team: add externally-found personnel the site roster omitted ────────────
  if (di.personnel.length) {
    schema.team ??= []
    const existing = new Set(schema.team.map((t) => t.name.toLowerCase()))
    for (const p of di.personnel) {
      if (p.name && !existing.has(p.name.toLowerCase())) {
        schema.team.push({ name: p.name, title: p.role ?? '', certifications: [], bio: p.notes ?? '', specializations: [] })
        existing.add(p.name.toLowerCase())
      }
    }
  }
}
