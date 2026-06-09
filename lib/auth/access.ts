import { NextResponse } from 'next/server'
import { createAuthClient, createServerClient } from '@/lib/supabase/server'

export type Role = 'admin' | 'manager'

export interface CurrentUser {
  id: string
  email?: string
  role: Role
}

// Identity + role for the calling request. Returns null when the request is
// unauthenticated or the authenticated user is not enrolled in `admins`.
// Uses the auth client (request cookies) — the self-read policy on `admins`
// from migration 001 lets a user read its own row.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createAuthClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: admin } = await supabase
    .from('admins')
    .select('id, email, role')
    .eq('id', user.id)
    .maybeSingle()

  if (!admin) return null
  return {
    id: admin.id,
    email: admin.email ?? user.email ?? undefined,
    role: admin.role === 'manager' ? 'manager' : 'admin',
  }
}

// Admin-only gate. Mirrors requireAdmin()'s `{ user } | NextResponse`
// convention but also returns role and 403s managers. Use for user
// management and destructive/global routes.
export async function requireAdminUser(): Promise<{ user: CurrentUser } | NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { user }
}

// Session-scoped gate. Admins always pass; managers pass only if a
// manager_clients row links them to sessionId. Uses the service-role client
// for the membership lookup so RLS can't interfere.
export async function requireSessionAccess(
  sessionId: string
): Promise<{ user: CurrentUser } | NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role === 'admin') return { user }

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
  if (user.role === 'admin') return { user, sessionId: job.session_id }

  const { data: link } = await supabase
    .from('manager_clients')
    .select('id')
    .eq('manager_id', user.id)
    .eq('session_id', job.session_id)
    .maybeSingle()

  if (!link) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { user, sessionId: job.session_id }
}

// Session IDs a user may act on. Admins → null ("all", callers skip the
// filter). Managers → explicit array of assigned ids (may be empty).
export async function getAccessibleSessionIds(
  user: CurrentUser
): Promise<string[] | null> {
  if (user.role === 'admin') return null
  const supabase = createServerClient()
  const { data } = await supabase
    .from('manager_clients')
    .select('session_id')
    .eq('manager_id', user.id)
  return (data ?? []).map(r => r.session_id)
}
