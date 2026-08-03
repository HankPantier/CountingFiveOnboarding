import { NextResponse } from 'next/server'
import { requireSessionAccess } from '@/lib/auth/access'
import {
  getPricingCalculator,
  savePricingCalculator,
} from '@/lib/content/pricing-calculator-config'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PutBody {
  config?: unknown
  enabled?: boolean
}

// Load the session's pricing calculator (or the default when none exists yet).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }
  const auth = await requireSessionAccess(sessionId)
  if (auth instanceof NextResponse) return auth

  const record = await getPricingCalculator(sessionId)
  return NextResponse.json(record)
}

// Upsert the session's pricing calculator config + enabled flag.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }
  const auth = await requireSessionAccess(sessionId)
  if (auth instanceof NextResponse) return auth

  let body: PutBody
  try {
    body = (await req.json()) as PutBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const enabled = body.enabled !== false // default true
  try {
    const config = await savePricingCalculator(
      sessionId,
      body.config,
      enabled,
      auth.user.id
    )
    return NextResponse.json({ config, enabled, exists: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
