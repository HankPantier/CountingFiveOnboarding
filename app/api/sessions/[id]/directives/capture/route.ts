import { NextResponse } from 'next/server'
import { requireOnboardingSessionAccess } from '@/lib/auth/access'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { createServerClient } from '@/lib/supabase/server'
import { internalError } from '@/lib/api/errors'
import { readJsonBody } from '@/app/api/_json'
import { coerceDirective } from '@/lib/onboarding/directives'
import { captureForDirective } from '@/lib/onboarding/interpret-directives'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_PER_HOUR = 60

interface CaptureBody {
  directive?: unknown
}

// POST /api/sessions/[id]/directives/capture — re-capture the verbatim snapshot
// for ONE instruction card after the rep re-points it (different page/person).
// Returns the card with a fresh snapshot + recomputed status. Writes only the
// private snapshot object; the card itself is saved by the Audit Review submit.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })

  const auth = await requireOnboardingSessionAccess(id)
  if (auth instanceof NextResponse) return auth

  if (!(await checkRateLimit(`directives-capture:${id}`, MAX_PER_HOUR, 60 * 60 * 1000))) {
    return NextResponse.json({ error: 'Too many requests — please wait a bit and try again.' }, { status: 429 })
  }

  const body = await readJsonBody<CaptureBody>(req)
  if (body instanceof NextResponse) return body
  const directive = coerceDirective(body.directive, id)
  if (!directive) return NextResponse.json({ error: 'Invalid instruction' }, { status: 400 })

  const supabase = createServerClient()
  const { data: session, error } = await supabase
    .from('sessions')
    .select('website_url, schema_data')
    .eq('id', id)
    .maybeSingle()
  if (error) return internalError('directives/capture', error)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const updated = await captureForDirective(
    supabase,
    id,
    session.website_url,
    (session.schema_data as SessionSchema | null) ?? {},
    directive,
    { task: 'onboarding', stage: 'mbp', sessionId: id, createdBy: auth.user.id },
  )
  return NextResponse.json({ directive: updated })
}
