import { cache } from 'react'
import { NextResponse } from 'next/server'
import { createAuthClient, createServerClient } from '@/lib/supabase/server'

// Account tier. 'admin' is the superuser (passes every gate). 'member' is a
// non-admin whose actual powers come from `capabilities`.
export type Role = 'admin' | 'member'

// Non-admin powers a member can hold, in any combination:
//   manager — site-scoped content access (via manager_clients)
//   auditor — own-audit access (scoped by audit_runs.created_by)
export type Capability = 'manager' | 'auditor'

const ALL_CAPABILITIES: Capability[] = ['manager', 'auditor']

export interface CurrentUser {
  id: string
  email?: string
  name?: string
  role: Role
  isAdmin: boolean
  capabilities: Capability[]
}

function normalizeCapabilities(raw: unknown): Capability[] {
  if (!Array.isArray(raw)) return []
  return ALL_CAPABILITIES.filter(c => raw.includes(c))
}

// Identity + powers for the calling request. Returns null when the request is
// unauthenticated or the authenticated user is not enrolled in `admins`.
// Uses the auth client (request cookies) — the self-read policy on `admins`
// from migration 001 lets a user read its own row.
// React.cache() dedupes within one RSC render pass: the root layout, section
// layout, and page each call this, which was 3× two DB round-trips per request.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createAuthClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: admin } = await supabase
    .from('admins')
    .select('id, email, name, role, capabilities')
    .eq('id', user.id)
    .maybeSingle()

  if (!admin) return null
  const isAdmin = admin.role === 'admin'
  return {
    id: admin.id,
    email: admin.email ?? user.email ?? undefined,
    name: admin.name ?? undefined,
    role: isAdmin ? 'admin' : 'member',
    isAdmin,
    capabilities: isAdmin ? ALL_CAPABILITIES : normalizeCapabilities(admin.capabilities),
  }
})

// True when the user is an admin or holds the given capability. Admins hold
// every capability implicitly.
export function hasCapability(user: CurrentUser, capability: Capability): boolean {
  return user.isAdmin || user.capabilities.includes(capability)
}

// Admin-only gate. Mirrors requireAdmin()'s `{ user } | NextResponse`
// convention but also returns role and 403s non-admins. Use for user
// management and destructive/global routes.
export async function requireAdminUser(): Promise<{ user: CurrentUser } | NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { user }
}

// Session-scoped gate. Admins always pass; otherwise the user must hold the
// `manager` capability AND a manager_clients row linking them to sessionId.
// Uses the service-role client for the membership lookup so RLS can't interfere.
export async function requireSessionAccess(
  sessionId: string
): Promise<{ user: CurrentUser } | NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.isAdmin) return { user }
  if (!user.capabilities.includes('manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServerClient()
  const { data: link } = await supabase
    .from('manager_clients')
    .select('id')
    .eq('manager_id', user.id)
    .eq('session_id', sessionId)
    .maybeSingle()

  if (!link) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { user }
}

// Content-job-scoped gate. Resolves the job's session_id (the documented
// content-job → session mapping) then applies the session access check.
// 404s when the job doesn't exist.
export async function requireContentJobAccess(
  contentJobId: string
): Promise<{ user: CurrentUser; sessionId: string } | NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id')
    .eq('id', contentJobId)
    .single()

  if (!job) return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
  if (user.isAdmin) return { user, sessionId: job.session_id }
  if (!user.capabilities.includes('manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: link } = await supabase
    .from('manager_clients')
    .select('id')
    .eq('manager_id', user.id)
    .eq('session_id', job.session_id)
    .maybeSingle()

  if (!link) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { user, sessionId: job.session_id }
}

// Capability gate for audit list/create (before a specific audit exists).
// Admins pass; otherwise the user must hold the `auditor` capability.
export async function requireAuditorCapability(): Promise<{ user: CurrentUser } | NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasCapability(user, 'auditor')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return { user }
}

// Audit-scoped gate. Admins always pass; otherwise the user must hold the
// `auditor` capability AND own the audit (audit_runs.created_by). 404s when the
// audit doesn't exist. Uses the service-role client for the ownership lookup.
export async function requireAuditAccess(
  auditId: string
): Promise<{ user: CurrentUser } | NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.isAdmin) return { user }
  if (!user.capabilities.includes('auditor')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServerClient()
  const { data: run } = await supabase
    .from('audit_runs')
    .select('created_by')
    .eq('id', auditId)
    .maybeSingle()

  if (!run) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  if (run.created_by !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return { user }
}

// Session IDs a user may act on. Admins → null ("all", callers skip the
// filter). Members → explicit array of manager-assigned ids (empty when they
// hold no manager capability or have no assignments).
export async function getAccessibleSessionIds(
  user: CurrentUser
): Promise<string[] | null> {
  if (user.isAdmin) return null
  if (!user.capabilities.includes('manager')) return []
  const supabase = createServerClient()
  const { data } = await supabase
    .from('manager_clients')
    .select('session_id')
    .eq('manager_id', user.id)
  return (data ?? []).map(r => r.session_id)
}

// Ownership scope for listing audits. Admins → null ("all"); auditors → only
// their own runs (filter audit_runs by created_by = id).
export function getAccessibleAuditScope(
  user: CurrentUser
): { createdBy: string } | null {
  if (user.isAdmin) return null
  return { createdBy: user.id }
}
