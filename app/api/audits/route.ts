import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuditorCapability, getAccessibleAuditScope } from '@/lib/auth/access'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeDomain, normalizeInputUrl } from '@/lib/audit'

export const runtime = 'nodejs'

const CreateAuditSchema = z.object({
  url: z.string().min(1).max(2000),
  siteName: z.string().max(200).optional(),
  maxPages: z.number().int().min(1).max(250).optional(),
})

const DeleteAuditsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
})

// POST /api/audits — create a queued audit run (does not execute it).
export async function POST(req: Request) {
  const auth = await requireAuditorCapability()
  if (auth instanceof NextResponse) return auth

  // Each audit is a 250-page crawl plus AI intelligence calls — bound how many
  // one user can queue per hour (open item from the 2026-06-24 hardening pass).
  if (!(await checkRateLimit(`audit-create:${auth.user.id}`, 20, 60 * 60 * 1000))) {
    return NextResponse.json({ error: 'Audit limit reached — try again later' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = CreateAuditSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const url = normalizeInputUrl(parsed.data.url)
  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }
  const domain = normalizeDomain(url)

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('audit_runs')
    .insert({
      created_by: auth.user.id,
      url,
      domain,
      site_name: parsed.data.siteName ?? null,
      max_pages: parsed.data.maxPages ?? 50,
      audit_status: 'queued',
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[audits] create failed:', error)
    return NextResponse.json({ error: 'Failed to create audit' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}

// DELETE /api/audits — bulk-delete audit runs by id. Serves both single-row and
// multi-select deletes from the list (the client always sends an `ids` array).
// Auditors may only delete audits they own; admins may delete any.
// FK cascade removes audit_messages; token_usage.audit_id is SET NULL (billing
// rows survive, detached) — no manual dependent cleanup needed.
export async function DELETE(req: Request) {
  const auth = await requireAuditorCapability()
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = DeleteAuditsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const supabase = createServerClient()
  const scope = getAccessibleAuditScope(auth.user)
  let query = supabase.from('audit_runs').delete().in('id', parsed.data.ids)
  if (scope) query = query.eq('created_by', scope.createdBy)
  const { data, error } = await query.select('id')

  if (error) {
    console.error('[audits] bulk delete failed:', error)
    return NextResponse.json({ error: 'Failed to delete audits' }, { status: 500 })
  }
  return NextResponse.json({ deleted: data?.length ?? 0 })
}

// GET /api/audits — list audit runs (paginated, newest first). Auditors see
// only their own runs; admins see all.
export async function GET(req: Request) {
  const auth = await requireAuditorCapability()
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(req.url)
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 50))
  const offset = Math.max(0, Number(searchParams.get('offset')) || 0)

  const supabase = createServerClient()
  const scope = getAccessibleAuditScope(auth.user)
  let query = supabase
    .from('audit_runs')
    .select(
      'id, url, domain, site_name, audit_status, overall_score, overall_grade, pages_crawled, created_at, completed_at, error_message',
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (scope) query = query.eq('created_by', scope.createdBy)
  const { data, error } = await query

  if (error) {
    console.error('[audits] list failed:', error)
    return NextResponse.json({ error: 'Failed to list audits' }, { status: 500 })
  }
  return NextResponse.json({ audits: data ?? [] })
}
