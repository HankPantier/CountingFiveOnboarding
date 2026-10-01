import { NextResponse } from 'next/server'
import { requireOnboardingSessionAccess } from '@/lib/auth/access'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { createServerClient } from '@/lib/supabase/server'
import { internalError } from '@/lib/api/errors'
import { readJsonBody } from '@/app/api/_json'
import { interpretDirectives } from '@/lib/onboarding/interpret-directives'
import type { OperatorDirective, SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
export const maxDuration = 120

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_NOTES = 20000
const MAX_PER_HOUR = 30

interface InterpretBody {
  text?: unknown
}

export interface InterpretResponse {
  directives: OperatorDirective[]
  remainderNotes: string
}

// POST /api/sessions/[id]/directives/interpret — turn the Audit Review notes into
// typed instruction cards for the rep to confirm. Captures verbatim snapshots to
// private storage but writes nothing to the session; the confirmed cards are
// saved by the Audit Review submit.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })

  const auth = await requireOnboardingSessionAccess(id)
  if (auth instanceof NextResponse) return auth

  if (!(await checkRateLimit(`directives-interpret:${id}`, MAX_PER_HOUR, 60 * 60 * 1000))) {
    return NextResponse.json({ error: 'Too many requests — please wait a bit and try again.' }, { status: 429 })
  }

  const body = await readJsonBody<InterpretBody>(req)
  if (body instanceof NextResponse) return body
  const text = typeof body.text === 'string' ? body.text.slice(0, MAX_NOTES).trim() : ''
  if (!text) return NextResponse.json({ error: 'Nothing to interpret' }, { status: 400 })

  const supabase = createServerClient()
  const { data: session, error } = await supabase
    .from('sessions')
    .select('website_url, schema_data')
    .eq('id', id)
    .maybeSingle()
  if (error) return internalError('directives/interpret', error)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const result = await interpretDirectives(
    supabase,
    id,
    session.website_url,
    (session.schema_data as SessionSchema | null) ?? {},
    text,
    { task: 'onboarding', stage: 'mbp', sessionId: id, createdBy: auth.user.id },
  )
  if (!result) {
    return NextResponse.json({ error: 'Could not interpret the notes — please try again.' }, { status: 502 })
  }
  return NextResponse.json(result satisfies InterpretResponse)
}
