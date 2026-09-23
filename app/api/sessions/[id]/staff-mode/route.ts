import { NextResponse } from 'next/server'
import { requireOnboardingSessionAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { updateSessionWithCas, SessionNotFoundError } from '@/lib/session/schema-cas'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  let note: string | undefined
  try {
    const body = await req.json() as { note?: string }
    note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : undefined
  } catch { /* no body is fine */ }

  const supabase = createServerClient()

  try {
    await updateSessionWithCas(supabase, id, session => {
      const schema = (session.schema_data as Record<string, unknown> | null) ?? {}
      const meta = (schema._meta as Record<string, unknown> | undefined) ?? {}
      const merged = {
        ...schema,
        _meta: {
          ...meta,
          mode: 'staff' as const,
          ...(note ? { staff_note: note } : {}),
        },
      }

      return { update: { schema_data: asJson(merged) }, result: null }
    })
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    console.error('[staff-mode] write failed:', err)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  console.warn(`[mode] session=${id} mode=staff set_by=${auth.user.id}${note ? ' note=present' : ''}`)

  return NextResponse.json({ success: true, mode: 'staff' })
}
