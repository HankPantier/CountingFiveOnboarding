import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess, denySiteOwnerConfig } from '@/lib/auth/access'
import { seedPricingPlans } from '@/lib/content/pricing-plans-seed'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// AI-draft a starting config from the firm's pricing notes + services + audit
// pricing. Does NOT persist — returns the draft for the operator to review and
// save via PUT.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }
  const auth = await requireSessionAccess(sessionId)
  if (auth instanceof NextResponse) return auth
  const ownerDenied = denySiteOwnerConfig(auth.user)
  if (ownerDenied) return ownerDenied

  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', sessionId)
    .single()
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const { data: job } = await supabase
    .from('content_jobs')
    .select('id')
    .eq('session_id', sessionId)
    .maybeSingle()

  const config = await seedPricingPlans({
    schema: (session.schema_data ?? {}) as SessionSchema,
    sessionId,
    contentJobId: job?.id ?? null,
  })
  return NextResponse.json({ config })
}
