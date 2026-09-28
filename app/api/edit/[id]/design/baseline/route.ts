import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import type { DesignBaselineResponse } from '@/lib/design/studio-types'
import { requireDesignAdmin } from '../_design'
import { ensureDesignBaseline } from '../_baseline'

export const runtime = 'nodejs'
export const maxDuration = 30

// POST — make sure the session has a v0 design version, importing the current
// draft if it has none (idempotent). The editor's Design drawer calls this on
// open so its first chat commit can't 409 for a missing baseline. An import
// failure (malformed override markers, …) is reported in the body, not as a
// 5xx, like the Studio's state load. Admin-only.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  try {
    const { baseline } = await ensureDesignBaseline(createServerClient(), ctx)
    const response: DesignBaselineResponse = { baseline }
    return NextResponse.json(response)
  } catch (err) {
    return internalError('design:baseline', err, 'Couldn’t prepare the design history — try again.')
  }
}
