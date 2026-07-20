import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuditorCapability, getAccessibleAuditScope } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { AUDIT_GROUPS } from '@/lib/audit/audit-group'

export const runtime = 'nodejs'

const MoveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  group: z.enum(['prospect', 'working', 'client']),
})

// PATCH /api/audits/group — manually move audits between folders. Folders track
// the business, so this moves ALL of a selected site's runs (by domain) within
// the caller's access scope. Admins move any; auditors only their own.
export async function PATCH(req: Request) {
  const auth = await requireAuditorCapability()
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = MoveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const supabase = createServerClient()
  const scope = getAccessibleAuditScope(auth.user)

  // Resolve the domains of the selected runs, scoped to what the caller owns, so
  // an auditor can't move audits (or reveal domains) they don't own.
  let domainQuery = supabase.from('audit_runs').select('domain').in('id', parsed.data.ids)
  if (scope) domainQuery = domainQuery.eq('created_by', scope.createdBy)
  const { data: domainRows, error: domainErr } = await domainQuery
  if (domainErr) {
    console.error('[audit-group] domain lookup failed:', domainErr.message)
    return NextResponse.json({ error: 'Failed to move audits' }, { status: 500 })
  }

  const domains = [...new Set((domainRows ?? []).map((r) => r.domain))]
  if (domains.length === 0) return NextResponse.json({ moved: 0 })

  // Move every accessible run sharing those domains (whole-business move).
  let updateQuery = supabase
    .from('audit_runs')
    .update({ audit_group: parsed.data.group })
    .in('domain', domains)
  if (scope) updateQuery = updateQuery.eq('created_by', scope.createdBy)
  const { data: moved, error: updateErr } = await updateQuery.select('id')

  if (updateErr) {
    console.error('[audit-group] move failed:', updateErr.message)
    return NextResponse.json({ error: 'Failed to move audits' }, { status: 500 })
  }

  return NextResponse.json({ moved: moved?.length ?? 0, groups: AUDIT_GROUPS })
}
