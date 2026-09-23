import { NextResponse } from 'next/server'
import { requireOnboardingSessionAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { readJsonBody } from '@/app/api/_json'
import { applyGeoReview, type GeoReviewInput, type GeoAreaInput, type GeoScope } from '@/lib/agent/geo-review'
import type { SessionSchema } from '@/types/session-schema'
import { updateSessionWithCas, SessionNotFoundError } from '@/lib/session/schema-cas'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SCOPES: GeoScope[] = ['local', 'regional', 'national']

function asAreas(v: unknown): GeoAreaInput[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const r = raw as Record<string, unknown>
    const city = typeof r.city === 'string' ? r.city : ''
    if (!city.trim()) return []
    return [{
      city,
      county: typeof r.county === 'string' ? r.county : undefined,
      state: typeof r.state === 'string' ? r.state : undefined,
      primary: r.primary === true,
    }]
  })
}

// Records the operator's Phase-3 geographic scope review submitted from the
// GeographyReviewCard. Writing _meta.geo_review here is an advancement gate for
// Phase 3 → 4 (see lib/agent/phase-validators.ts). Idempotent — safe to re-POST.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  const auth = await requireOnboardingSessionAccess(id)
  if (auth instanceof NextResponse) return auth

  const body = await readJsonBody<{ scope?: unknown; areas?: unknown }>(req)
  if (body instanceof NextResponse) return body

  const scope = SCOPES.includes(body.scope as GeoScope) ? (body.scope as GeoScope) : null
  if (!scope) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }
  const input: GeoReviewInput = { scope, areas: asAreas(body.areas) }

  const supabase = createServerClient()

  let nextSchema: SessionSchema
  try {
    nextSchema = await updateSessionWithCas(supabase, id, session => {
      const schema = (session.schema_data as SessionSchema | null) ?? {}

      const nextSchema = applyGeoReview(schema, input, new Date().toISOString(), auth.user.id)

      return { update: { schema_data: asJson(nextSchema) }, result: nextSchema }
    })
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    console.error('[geo-reviewed] write failed:', err)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true, review: nextSchema._meta?.geo_review })
}
