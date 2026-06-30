// Maps the audit's intelligence layer into the onboarding session seed so the
// chat starts pre-informed. Fills schema fields that previously only came from
// MBP parsing: niches, reputation, business.affiliations, and the reserved
// content_gaps.nicheGaps / teamExpertiseGaps buckets. Also carries over data the
// draft used to discard — service rewrite directions, personnel associations,
// tech stack, domain dates — into typed fields where they exist and into
// _meta.audit_context otherwise. Mutates the passed schema.
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

// Audit-seeded sessions have no _meta until the chat creates it; initialize the
// required fields with their natural defaults so we can attach audit_context.
function ensureMeta(schema: SessionSchema): NonNullable<SessionSchema['_meta']> {
  schema._meta ??= {
    phase3_completed_chunks: [],
    phase4_resolved_tiers: { tier1_done: false, tier2_done: false },
    phase4_flagged_for_followup: [],
    admin_overrides: {},
  }
  return schema._meta
}

// The draft starts from emptySchema(), which omits `technical`. Build a complete
// (all-required-fields) empty technical object so we can seed hosting/registration
// without a partial-type error. WHOIS later merges its own fields on top.
function ensureTechnical(schema: SessionSchema): NonNullable<SessionSchema['technical']> {
  schema.technical ??= {
    registrar: '', registrationDate: '', expiryDate: '', nameservers: [],
    registrarUsername: '', registrarPin: '', registrarPasswordNote: '',
    adminContact: { name: '', phone: '', email: '' },
    hostingProvider: '', hostingContact: '', hostingPhone: '', hostingEmail: '',
    redirectDomains: [],
  }
  return schema.technical
}

export function enrichSchemaFromIntelligence(
  schema: SessionSchema,
  intel: AuditIntelligence,
): void {
  const niche = intel.niche_services
  const di = intel.digital_intelligence

  // ── Audit context: carry intel with no typed schema home into _meta so the
  //    chat can confirm it and the MBP can render it (instead of discarding). ──
  seedAuditContext(schema, intel)

  // ── Competitors: audit-discovered firms → business.competitors ──────────────
  if (intel.competitors?.competitors?.length && schema.business) {
    const existing = new Set((schema.business.competitors ?? []).map((c) => c.name.trim().toLowerCase()))
    const additions = intel.competitors.competitors.filter(
      (c) => c.name && !existing.has(c.name.trim().toLowerCase()),
    )
    if (additions.length) {
      schema.business.competitors = [...(schema.business.competitors ?? []), ...additions]
    }
  }

  // ── Services: carry the analyst's rewrite direction onto matching services ──
  if (niche?.services_analysis?.length && schema.services?.length) {
    const byName = new Map(schema.services.map((s) => [s.name.trim().toLowerCase(), s]))
    for (const sa of niche.services_analysis) {
      const match = byName.get(sa.service?.trim().toLowerCase() ?? '')
      if (match && sa.rewrite_direction && !match.rewriteDirection) {
        match.rewriteDirection = sa.rewrite_direction
      }
    }
  }

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

  // ── Team: add externally-found personnel the roster omitted; for personnel
  //    already on the roster, merge their associations (previously dropped). ───
  if (di.personnel.length) {
    schema.team ??= []
    const byName = new Map(schema.team.map((t) => [t.name.toLowerCase(), t]))
    for (const p of di.personnel) {
      if (!p.name) continue
      const existing = byName.get(p.name.toLowerCase())
      if (existing) {
        if (p.associations?.length) {
          existing.associations = dedup([...(existing.associations ?? []), ...p.associations])
        }
      } else {
        const member = {
          name: p.name, title: p.role ?? '', certifications: [], bio: p.notes ?? '', specializations: [],
          ...(p.associations?.length ? { associations: dedup(p.associations) } : {}),
        }
        schema.team.push(member)
        byName.set(p.name.toLowerCase(), member)
      }
    }
  }
}

// Carries audit intelligence with no typed schema field into _meta.audit_context,
// plus the two facts that DO have typed homes: tech-stack hosting and the domain
// registration date (seeded as fallbacks; WHOIS overwrites registration if it
// succeeds — see lib/whois/lookup.ts merge).
function seedAuditContext(schema: SessionSchema, intel: AuditIntelligence): void {
  const ctx: NonNullable<NonNullable<SessionSchema['_meta']>['audit_context']> = {}

  if (intel.narrative) {
    const recs = intel.narrative.recommendations?.map((r) => r.title).filter(Boolean) ?? []
    ctx.narrative = {
      executiveSummary: intel.narrative.executive_summary || undefined,
      recommendations: recs.length ? recs : undefined,
    }
  }
  if (intel.tech_stack) {
    const t = intel.tech_stack
    ctx.techStack = {
      cms: t.cms, pageBuilder: t.page_builder, hosting: t.hosting,
      frameworks: t.frameworks?.length ? t.frameworks : undefined,
      riskFlags: t.risk_flags?.length ? t.risk_flags : undefined,
      commentary: t.commentary || undefined,
    }
    if (t.hosting) {
      const tech = ensureTechnical(schema)
      if (!tech.hostingProvider) tech.hostingProvider = t.hosting
    }
  }
  if (intel.domain) {
    ctx.domain = {
      registered: intel.domain.registered, ageYears: intel.domain.age_years, lastUpdated: intel.domain.last_updated,
    }
    if (intel.domain.registered) {
      const tech = ensureTechnical(schema)
      if (!tech.registrationDate) tech.registrationDate = intel.domain.registered
    }
  }
  if (intel.content_library) {
    const c = intel.content_library
    ctx.contentLibrary = {
      totalPieces: c.total_pieces || undefined,
      formats: c.formats?.length ? c.formats : undefined,
      recommendations: c.recommendations?.length ? c.recommendations : undefined,
    }
  }
  if (intel.competitive) {
    const c = intel.competitive
    ctx.competitive = {
      keywordRankings: c.keyword_rankings?.length ? c.keyword_rankings : undefined,
      aiSearchPresence: c.ai_search_presence || undefined,
      localSeo: c.local_seo || undefined,
    }
  }

  if (Object.keys(ctx).length > 0) ensureMeta(schema).audit_context = ctx
}
