export const runtime = 'nodejs'
// PDF generation + dual storage upload (intake summary + MBP) can exceed the
// 30s default on a large session; 60s gives headroom.
export const maxDuration = 60

import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/auth/access'
import { generateAndStoreMbp } from '@/lib/mbp/generate-deliverable'
import { computeCompleteness } from '@/lib/mbp/completeness'
import type { GapItem } from '@/types/gap-item'
import type { SessionSchema } from '@/types/session-schema'
import { NextResponse } from 'next/server'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth
  const user = auth.user

  const { id } = await params

  // Optional override to approve despite unresolved Tier-1 gaps (e.g. a
  // force-completed session). Default off so incompleteness is surfaced first.
  const body = await req.json().catch(() => ({})) as { override?: boolean }
  const override = body?.override === true

  const supabase = createServerClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('id, status, schema_data, gap_list')
    .eq('id', id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status === 'approved') {
    return NextResponse.json({ error: 'Session already approved' }, { status: 409 })
  }
  if (session.status !== 'completed') {
    return NextResponse.json({ error: 'Session is not completed' }, { status: 400 })
  }

  // Completeness gate: a force-completed session can reach 'completed' with
  // unresolved Tier-1 gaps. Surface them and require an explicit override rather
  // than silently approving a thin profile into content generation.
  if (!override) {
    const { tier1Open } = computeCompleteness(
      (session.schema_data as SessionSchema) ?? {},
      (session.gap_list as GapItem[]) ?? [],
    )
    if (tier1Open.length > 0) {
      return NextResponse.json(
        {
          error: 'incomplete',
          incompleteFields: tier1Open.map((g) => g.label),
        },
        { status: 422 },
      )
    }
  }

  try {
    // Generate the MBP deliverable in-process (no self-fetch / NEXT_PUBLIC_APP_URL
    // dependency). Non-fatal: a failure must not block approval, but it IS
    // surfaced so the admin can retry rather than discovering a null pdf_url.
    let pdfStoragePath: string | null = null
    let deliverableError: string | null = null
    try {
      const res = await generateAndStoreMbp(supabase, id)
      pdfStoragePath = res.pdfStoragePath
    } catch (err) {
      console.error('[Approve] MBP generation failed (non-fatal):', err)
      deliverableError = err instanceof Error ? err.message : 'MBP generation failed'
    }

    // Atomic guard: only flip a not-yet-approved row. A concurrent approval that
    // already set status='approved' matches 0 rows here, closing the TOCTOU window
    // between the check above and this write (never re-approve a session).
    const { data: approved } = await supabase
      .from('sessions')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: user.id,
        content_generation_ready: true,
        pdf_url: pdfStoragePath,
      })
      .eq('id', id)
      .neq('status', 'approved')
      .select('id')

    if (!approved?.length) {
      return NextResponse.json({ error: 'Session already approved' }, { status: 409 })
    }

    return NextResponse.json({ success: true, deliverableError })
  } catch (err) {
    console.error('[Approve]', err)
    const message = err instanceof Error ? err.message : 'Approval failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
