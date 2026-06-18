import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { requireAuditAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// POST /api/audits/[id]/share — enable a public share link (idempotent: an
// existing token is returned unchanged so the link stays stable).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireAuditAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  const { data: run } = await supabase
    .from('audit_runs')
    .select('id, audit_status, result, share_token')
    .eq('id', id)
    .single()

  if (!run) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  if (run.audit_status !== 'complete' || !run.result) {
    return NextResponse.json({ error: 'Audit is not complete' }, { status: 409 })
  }
  if (run.share_token) return NextResponse.json({ token: run.share_token })

  const token = randomBytes(24).toString('base64url')
  const { error } = await supabase
    .from('audit_runs')
    .update({ share_token: token, shared_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not create share link' }, { status: 500 })

  return NextResponse.json({ token })
}

// DELETE /api/audits/[id]/share — revoke the public link.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireAuditAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  const { error } = await supabase
    .from('audit_runs')
    .update({ share_token: null, shared_at: null })
    .eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not revoke share link' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
