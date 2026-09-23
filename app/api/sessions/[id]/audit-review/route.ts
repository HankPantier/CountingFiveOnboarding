import { NextResponse } from 'next/server'
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
import type { SessionSchema } from '@/types/session-schema'
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

  const supabase = createServerClient()
  let schema: SessionSchema
  try {
    schema = await updateSessionWithCas(supabase, id, row => {
      let schema = (row.schema_data as SessionSchema | null) ?? {}
      let gaps = (row.gap_list as GapItem[] | null) ?? []
      const now = new Date().toISOString()
      const by = auth.user.id

      // Niches: treatments carry page/block/exclude + origin; add = every non-excluded
      // name (applyNicheReview's add loop dedups names already in the array).
      const nicheAdd = nicheTreatments.filter((t) => t.pageTreatment !== 'exclude').map((t) => t.name)
      ;({ schema, gaps } = applyNicheReview(schema, gaps, { treatments: nicheTreatments, add: nicheAdd }, now, by))

      const serviceAdd = serviceTreatments.filter((t) => t.pageTreatment !== 'exclude').map((t) => t.name)
      ;({ schema, gaps } = applyServiceReview(schema, gaps, { treatments: serviceTreatments, add: serviceAdd }, now, by))

      // Sub-services after niches (applySubCategoryReview skips dropped niches).
      ;({ schema, gaps } = applySubCategoryReview(schema, gaps, { treatments: subTreatments }, now, by))

      if (geo) schema = applyGeoReview(schema, geo, now, by)
      // A resubmit without a team section leaves the earlier team decision intact.
      if (body.team !== undefined) schema = applyTeamReview(schema, team, now, by)

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

  return NextResponse.json({
    success: true,
    markers: {
      niche_review: schema._meta?.niche_review,
      services_review: schema._meta?.services_review,
      subcategories_review: schema._meta?.subcategories_review,
      geo_review: schema._meta?.geo_review,
      team_review: schema._meta?.team_review,
    },
  })
}
