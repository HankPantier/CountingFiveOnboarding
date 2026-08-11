import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { pullHeadshotForMember } from '@/lib/team-photos/pull-headshot'
import type { SessionSchema } from '@/types/session-schema'

// Node runtime: node:dns (SSRF guard), binary fetch, file-type magic bytes.
export const runtime = 'nodejs'

// POST { memberName, imageUrl } — server-side fetch the rep-chosen live-site
// image, validate it by magic bytes, store it as a team-photo asset for that
// member. One member per call. The fetch/validate/store logic lives in the
// shared pull-headshot helper (also used by the audit auto-pull).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireSessionAccess(id)
  if (auth instanceof NextResponse) return auth

  let body: { memberName?: unknown; imageUrl?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { memberName, imageUrl } = body
  if (typeof memberName !== 'string' || !memberName.trim()) {
    return NextResponse.json({ error: 'memberName is required' }, { status: 400 })
  }
  if (typeof imageUrl !== 'string' || !imageUrl) {
    return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // Only tag photos to members that actually exist on the profile — blocks
  // arbitrary metadata being written to the assets table.
  const schema = (session.schema_data as SessionSchema | null) ?? {}
  const team = Array.isArray(schema.team) ? schema.team : []
  if (!team.some((m) => m.name === memberName)) {
    return NextResponse.json({ error: 'Unknown team member' }, { status: 400 })
  }

  // Manual pull allows swapping an existing photo (skipIfExists left false).
  const result = await pullHeadshotForMember({ supabase, sessionId: id, memberName, imageUrl })
  if (result.status === 'error') {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus })
  }
  if (result.status === 'skipped') {
    return NextResponse.json({ skipped: true })
  }
  return NextResponse.json({ assetId: result.assetId, storagePath: result.storagePath })
}
