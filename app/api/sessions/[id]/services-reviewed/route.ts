import { NextResponse } from 'next/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { readJsonBody } from '@/app/api/_json'
import { applyServiceReview, type ServiceReviewInput } from '@/lib/agent/service-review'
import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

// Records the operator's Phase-3 service keep/drop review submitted from the
// ServiceReviewCard. Writing _meta.services_review here is an advancement gate for
// Phase 3 → 4 (see lib/agent/phase-validators.ts). Idempotent — safe to re-POST.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  const auth = await requireSessionAccess(id)
  if (auth instanceof NextResponse) return auth

  const body = await readJsonBody<Partial<ServiceReviewInput>>(req)
  if (body instanceof NextResponse) return body

  const input: ServiceReviewInput = {
    keep: asStringArray(body.keep),
    drop: asStringArray(body.drop),
    add: asStringArray(body.add),
  }

  const supabase = createServerClient()

  const { data: session, error: readErr } = await supabase
    .from('sessions')
    .select('schema_data, gap_list')
    .eq('id', id)
    .single()

  if (readErr || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const schema = (session.schema_data as SessionSchema | null) ?? {}
  const gaps = (session.gap_list as GapItem[] | null) ?? []

  const { schema: nextSchema, gaps: nextGaps } = applyServiceReview(
    schema,
    gaps,
    input,
    new Date().toISOString(),
    auth.user.id,
  )

  const { error: writeErr } = await supabase
    .from('sessions')
    .update({ schema_data: asJson(nextSchema), gap_list: asJson(nextGaps) })
    .eq('id', id)

  if (writeErr) {
    console.error('[services-reviewed] write failed:', writeErr)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true, review: nextSchema._meta?.services_review })
}
