import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { setAdoptedConceptId } from '@/lib/design/chat-store'
import { requireDesignAdmin } from '../../_design'

export const runtime = 'nodejs'

interface ClearAdoptResponse {
  ok: true
}

type Params = { params: Promise<{ id: string }> }

// DELETE — stop keeping the "Fix in chat" concept in the chat's context.
// Admin-only; scoped to the gated session.
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  try {
    const saved = await setAdoptedConceptId(createServerClient(), ctx.sessionId, null)
    if (!saved) return NextResponse.json({ error: 'The concept could not be cleared. Try again.' }, { status: 503 })
    const response: ClearAdoptResponse = { ok: true }
    return NextResponse.json(response)
  } catch (err) {
    return internalError('design:chat:adopt', err, 'Failed to clear the concept')
  }
}
