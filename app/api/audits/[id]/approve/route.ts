import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// POST /api/audits/[id]/approve — mark a completed audit approved, which unlocks
// the "Start session" workflow.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = createServerClient()

  const { data: run } = await supabase
    .from('audit_runs')
    .select('audit_status, approved_at')
    .eq('id', id)
    .single()

  if (!run) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  if (run.audit_status !== 'complete') {
    return NextResponse.json({ error: 'Audit is not complete' }, { status: 409 })
  }
  if (run.approved_at) {
    return NextResponse.json({ error: 'Audit is already approved' }, { status: 409 })
  }

  const { error } = await supabase
    .from('audit_runs')
    .update({ approved_at: new Date().toISOString(), approved_by: auth.user.id })
    .eq('id', id)

  if (error) {
    console.error('[audits] approve failed:', error)
    return NextResponse.json({ error: 'Failed to approve audit' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
