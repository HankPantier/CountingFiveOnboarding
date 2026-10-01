import { NextResponse, after } from 'next/server'
import { requireOnboardingSessionAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { readJsonBody } from '@/app/api/_json'
import { applyNicheReview, type NicheTreatment } from '@/lib/agent/niche-review'
import { applyServiceReview, type ServiceTreatment } from '@/lib/agent/service-review'
import { applySubCategoryReview, type SubCategoryTreatment } from '@/lib/agent/subcategory-review'
import { applyGeoReview, type GeoAreaInput, type GeoScope } from '@/lib/agent/geo-review'
import { applyTeamReview, type TeamAddition } from '@/lib/agent/team-review'
import { refreshPhase4Gaps } from '@/lib/agent/gap-tiering'
import { applyDirectives, offeringTreatments } from '@/lib/agent/directive-review'
import {
  MAX_DIRECTIVES,
  coerceDirective,
  crawledPages,
  isVerbatimSubstring,
  notesWithoutDirectives,
  resolveDirectiveStatus,
} from '@/lib/onboarding/directives'
import { readSnapshot } from '@/lib/onboarding/page-snapshot'
import { applyNotesExtraction } from '@/lib/session-draft/apply-notes-extraction'
import type { OperatorDirective, SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'
import { updateSessionWithCas, SessionNotFoundError, type CasSessionUpdate } from '@/lib/session/schema-cas'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_NOTES = 20000

// The consolidated Audit Review submit. One atomic read → apply every review
// helper in memory → single write, so the four *_review markers + team + notes
// never race on the same JSONB blob (which they would if the UI posted the four
// legacy *-reviewed routes separately). Also flips notes_extracted_at so the
// onboarding stage machine advances to the MBP Review step. Idempotent.
type TreatmentInput = {
  name?: unknown
  pageTreatment?: unknown
  parent?: unknown
  origin?: unknown
}
type SubTreatmentInput = TreatmentInput & { niche?: unknown }

interface AuditReviewBody {
  callNotes?: unknown
  niches?: unknown
  services?: unknown
  subcategories?: unknown
  geo?: unknown
  team?: unknown
  directives?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const isTreatment = (v: unknown): v is 'page' | 'block' | 'exclude' =>
  v === 'page' || v === 'block' || v === 'exclude'
const asOrigin = (v: unknown): 'site' | 'audit' | undefined =>
  v === 'site' || v === 'audit' ? v : undefined

function coerceTreatments(raw: unknown): NicheTreatment[] {
  if (!Array.isArray(raw)) return []
  const out: NicheTreatment[] = []
  for (const r of raw as TreatmentInput[]) {
    const name = str(r?.name)
    if (!name || !isTreatment(r?.pageTreatment)) continue
    out.push({
      name,
      pageTreatment: r.pageTreatment,
      ...(str(r.parent) ? { parent: str(r.parent) } : {}),
      ...(asOrigin(r.origin) ? { origin: asOrigin(r.origin) } : {}),
    })
  }
  return out
}

function coerceSubTreatments(raw: unknown): SubCategoryTreatment[] {
  if (!Array.isArray(raw)) return []
  const out: SubCategoryTreatment[] = []
  for (const r of raw as SubTreatmentInput[]) {
    const niche = str(r?.niche)
    const name = str(r?.name)
    if (!niche || !name || !isTreatment(r?.pageTreatment)) continue
    out.push({
      niche,
      name,
      pageTreatment: r.pageTreatment,
      ...(str(r.parent) ? { parent: str(r.parent) } : {}),
      ...(asOrigin(r.origin) ? { origin: asOrigin(r.origin) } : {}),
    })
  }
  return out
}

function coerceGeo(raw: unknown): { scope: GeoScope; areas: GeoAreaInput[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { scope?: unknown; areas?: unknown }
  const scope = r.scope
  if (scope !== 'local' && scope !== 'regional' && scope !== 'national') return null
  const areas: GeoAreaInput[] = Array.isArray(r.areas)
    ? (r.areas as Record<string, unknown>[]).flatMap((a) => {
        const city = str(a?.city)
        if (!city) return []
        return [{
          city,
          ...(str(a?.county) ? { county: str(a.county) } : {}),
          ...(str(a?.state) ? { state: str(a.state) } : {}),
          ...(a?.primary === true ? { primary: true } : {}),
        }]
      })
    : []
  return { scope, areas }
}

function coerceTeam(raw: unknown): { keep: string[]; remove: string[]; add: TeamAddition[] } {
  if (!raw || typeof raw !== 'object') return { keep: [], remove: [], add: [] }
  const r = raw as { keep?: unknown; remove?: unknown; add?: unknown }
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(str).filter(Boolean) : []
  const add: TeamAddition[] = Array.isArray(r.add)
    ? (r.add as Record<string, unknown>[]).flatMap((m) => {
        const name = str(m?.name)
        return name ? [{ name, ...(str(m?.title) ? { title: str(m.title) } : {}) }] : []
      })
    : []
  return { keep: strArr(r.keep), remove: strArr(r.remove), add }
}

function coerceDirectives(raw: unknown, sessionId: string): OperatorDirective[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: OperatorDirective[] = []
  for (const r of raw.slice(0, MAX_DIRECTIVES)) {
    const d = coerceDirective(r, sessionId)
    if (!d || seen.has(d.id)) continue
    seen.add(d.id)
    out.push(d)
  }
  return out
}

// A verbatim passage is only trusted when it is still an exact substring of the
// stored snapshot — the client could otherwise post altered "verbatim" text.
async function verifyVerbatimPassages(
  supabase: ReturnType<typeof createServerClient>,
  sessionId: string,
  directives: OperatorDirective[],
): Promise<void> {
  await Promise.all(
    directives.map(async (d) => {
      if (d.kind !== 'verbatim_content' || !d.verbatimText) return
      const source = d.snapshot ? await readSnapshot(supabase, sessionId, d.snapshot.path) : null
      if (!source || !isVerbatimSubstring(d.verbatimText, source)) delete d.verbatimText
    }),
  )
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  const auth = await requireOnboardingSessionAccess(id)
  if (auth instanceof NextResponse) return auth

  const body = await readJsonBody<AuditReviewBody>(req)
  if (body instanceof NextResponse) return body

  const nicheTreatments = coerceTreatments(body.niches)
  const serviceTreatments = coerceTreatments(body.services) as ServiceTreatment[]
  const subTreatments = coerceSubTreatments(body.subcategories)
  const geo = coerceGeo(body.geo)
  const team = coerceTeam(body.team)
  const callNotes = typeof body.callNotes === 'string' ? body.callNotes.slice(0, MAX_NOTES) : null
  const directivesSent = body.directives !== undefined
  const directives = coerceDirectives(body.directives, id)

  const supabase = createServerClient()
  const { data: prior } = await supabase.from('sessions').select('call_notes').eq('id', id).maybeSingle()
  const notesChanged = callNotes !== null && callNotes.trim() !== (prior?.call_notes ?? '').trim()
  await verifyVerbatimPassages(supabase, id, directives)
  let schema: SessionSchema
  try {
    schema = await updateSessionWithCas(supabase, id, row => {
      let schema = (row.schema_data as SessionSchema | null) ?? {}
      let gaps = (row.gap_list as GapItem[] | null) ?? []
      const now = new Date().toISOString()
      const by = auth.user.id

      // Status is never trusted from the client: re-resolve against this row's
      // real crawled pages and team. A resubmit without a directives field keeps
      // the stored ones.
      const pages = crawledPages(schema)
      const teamNames = (schema.team ?? []).filter((m) => m?.name).map((m) => m.name)
      let active: OperatorDirective[] = directivesSent
        ? directives.map((d) => ({ ...d, createdBy: d.createdBy ?? by, status: resolveDirectiveStatus(d, pages, teamNames) }))
        : (schema.operator_directives ?? [])
      const offerings = offeringTreatments(active)

      // Niches: treatments carry page/block/exclude + origin; add = every non-excluded
      // name (applyNicheReview's add loop dedups names already in the array).
      const allNiches = [...nicheTreatments, ...offerings.niches]
      const allServices = [...serviceTreatments, ...offerings.services]
      const nicheAdd = allNiches.filter((t) => t.pageTreatment !== 'exclude').map((t) => t.name)
      ;({ schema, gaps } = applyNicheReview(schema, gaps, { treatments: allNiches, add: nicheAdd }, now, by))

      const serviceAdd = allServices.filter((t) => t.pageTreatment !== 'exclude').map((t) => t.name)
      ;({ schema, gaps } = applyServiceReview(schema, gaps, { treatments: allServices, add: serviceAdd }, now, by))

      // Sub-services after niches (applySubCategoryReview skips dropped niches).
      ;({ schema, gaps } = applySubCategoryReview(schema, gaps, { treatments: subTreatments }, now, by))

      if (geo) schema = applyGeoReview(schema, geo, now, by)
      // A resubmit without a team section leaves the earlier team decision intact.
      if (body.team !== undefined) schema = applyTeamReview(schema, team, now, by)

      // After team review, so a verbatim bio lands on the kept member record —
      // and re-resolved against the post-review team, so a bio for someone this
      // same submit added resolves instead of being dropped as "unclear".
      if (directivesSent) {
        const postTeam = (schema.team ?? []).filter((m) => m?.name).map((m) => m.name)
        active = active.map((d) => ({ ...d, status: resolveDirectiveStatus(d, pages, postTeam) }))
      }
      ;({ schema, gaps } = applyDirectives(schema, gaps, active))

      // Add Phase-4 gaps for any niche/service this review added (gaps are otherwise
      // only computed at session creation), then tier by page treatment: a
      // content-block item is a section, not a page, so its deep page-only gaps are
      // dropped to keep the downstream Q&A focused.
      gaps = refreshPhase4Gaps(schema, gaps)

      // Umbrella marker (convenience — the individual *_review markers are the gates).
      schema._meta = {
        ...(schema._meta ?? {
          phase3_completed_chunks: [],
          phase4_resolved_tiers: { tier1_done: false, tier2_done: false },
          phase4_flagged_for_followup: [],
          admin_overrides: {},
        }),
        audit_review: { reviewedAt: now, reviewedBy: by },
      }

      const update: CasSessionUpdate = {
        schema_data: asJson(schema),
        gap_list: asJson(gaps),
        notes_extracted_at: now,
      }
      if (callNotes !== null) update.call_notes = callNotes
      return { update, result: schema }
    })
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    console.error('[audit-review] write failed:', err)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  // Notes → MBP facts, minus the sentences already captured as instructions.
  // Background so the submit stays fast; blank-fill only, so it never clobbers.
  const factNotes = notesChanged ? notesWithoutDirectives(callNotes ?? '', schema.operator_directives ?? []) : ''
  if (factNotes) {
    // Scheduling is guarded so a hook failure can never fail the saved review.
    try {
      after(async () => {
        try {
          await applyNotesExtraction(supabase, id, factNotes, {
            task: 'onboarding',
            stage: 'mbp',
            sessionId: id,
            createdBy: auth.user.id,
          })
        } catch (err) {
          console.error('[audit-review] notes extraction failed:', err)
        }
      })
    } catch (err) {
      console.warn('[audit-review] could not schedule notes extraction:', err)
    }
  }

  return NextResponse.json({
    success: true,
    markers: {
      niche_review: schema._meta?.niche_review,
      services_review: schema._meta?.services_review,
      subcategories_review: schema._meta?.subcategories_review,
      geo_review: schema._meta?.geo_review,
      team_review: schema._meta?.team_review,
    },
    directives: schema.operator_directives ?? [],
  })
}
