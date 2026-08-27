import { cache } from 'react'
import { NextResponse } from 'next/server'
import { createAuthClient, createServerClient } from '@/lib/supabase/server'

// Account tier. 'admin' is the superuser (passes every gate). 'member' is a
// non-admin whose actual powers come from `capabilities`.
export type Role = 'admin' | 'member'

// Non-admin powers a member can hold, in any combination:
//   manager — site-scoped content access (via manager_clients), incl. publishing
//   editor  — site-scoped content access like manager, but CANNOT push to live
//             (Publish/Rollback denied — see canPublish); assigned via manager_clients
//   owner   — Site Owner: the end client for ONE site. Site-scoped content access
//             + publish (like manager) but locked down — assigned to exactly one
//             content-ready session, dropped straight into that editor, and denied
//             theme/nav/site-assistant and every non-content admin surface. The
//             role is exclusive (a member holding it holds nothing else) and its
//             lockdown lives in the UI + user-management routes, not here.
//   auditor — own-audit access (scoped by audit_runs.created_by)
// manager, editor, and owner are tiers of the same content role: a member holds
// at most one of them (enforced by the user-management routes).
export type Capability = 'manager' | 'auditor' | 'editor' | 'owner'

const ALL_CAPABILITIES: Capability[] = ['manager', 'auditor', 'editor', 'owner']

// Capabilities that grant site-scoped content access (the draft editor + all
// session-scoped content routes). manager and owner can also publish; editor cannot.
const CONTENT_CAPABILITIES: Capability[] = ['manager', 'editor', 'owner']

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

// True when the user has site-scoped content access — the draft editor and all
// session-scoped content routes. Both manager and editor qualify (admins always).
export function hasContentAccess(user: CurrentUser): boolean {
  return user.isAdmin || CONTENT_CAPABILITIES.some(c => user.capabilities.includes(c))
}

// True when the user may push content to the live site (Publish / Rollback).
// Editors are content users who are denied this; admins, managers, and site
// owners (who publish their own single site) pass.
export function canPublish(user: CurrentUser): boolean {
  return user.isAdmin || user.capabilities.includes('manager') || user.capabilities.includes('owner')
}

// True when the user is a Site Owner — a member whose single content capability
// is `owner`. Admins hold every capability implicitly, so the !isAdmin guard is
// what keeps staff on the full UI rather than the locked-down owner view.
export function isSiteOwner(user: CurrentUser): boolean {
  return !user.isAdmin && user.capabilities.includes('owner')
}

// Config surfaces (nav.json, client-center.json, Theme Studio, Site Assistant)
// are staff-only: a Site Owner edits their site's page content but NOT its
// structure/config. Returns a 403 NextResponse for owners, null to proceed.
// The UI hides these surfaces for owners too, but the guarantee (CLAUDE.md
// rule 6) must hold server-side — the routes use the service-role client, so a
// hidden button is not a control. Admins/managers/editors pass.
export function denySiteOwnerConfig(user: CurrentUser): NextResponse | null {
  return isSiteOwner(user)
    ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    : null
}

// The single session a Site Owner is assigned to (their one content repo), or
// null if they have no assignment yet. Used to drop them straight into their
// editor after login and to guard against reaching another site's editor.
export async function getSiteOwnerSessionId(user: CurrentUser): Promise<string | null> {
  if (!isSiteOwner(user)) return null
  const supabase = createServerClient()
  const { data } = await supabase
    .from('manager_clients')
    .select('session_id')
    .eq('manager_id', user.id)
    .limit(1)
    .maybeSingle()
  return data?.session_id ?? null
}

// True when the user may reach the Onboarding surface (dashboard, sessions,
// batch content) — the `manager` capability (or admin). Editors are content
// users WITHOUT onboarding access, so this is what separates their "Content
// only" navigation from a manager's.
export function hasOnboardingAccess(user: CurrentUser): boolean {
  return user.isAdmin || user.capabilities.includes('manager')
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

// Session-scoped gate. Admins always pass; otherwise the user must hold a
// content capability (`manager` or `editor`) AND a manager_clients row linking
// them to sessionId. Editors reach every session-scoped content route this
// gates; the two live-mutating routes (publish/rollback) additionally require
// canPublish(). Uses the service-role client for the membership lookup so RLS
// can't interfere.
export async function requireSessionAccess(
  sessionId: string
): Promise<{ user: CurrentUser } | NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.isAdmin) return { user }
  if (!hasContentAccess(user)) {
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

// Audit-batch ownership gate — mirrors requireAuditAccess. Admins pass; an
// auditor-capable member passes only for a batch they created. Guards the
// batch run/status routes against cross-owner reads.
export async function requireAuditBatchAccess(
  batchId: string
): Promise<{ user: CurrentUser } | NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.isAdmin) return { user }
  if (!user.capabilities.includes('auditor')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServerClient()
  const { data: batch } = await supabase
    .from('audit_batches')
    .select('created_by')
    .eq('id', batchId)
    .maybeSingle()

  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  if (batch.created_by !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return { user }
}

// Session IDs a user may act on. Admins → null ("all", callers skip the
// filter). Members → explicit array of assigned ids (empty when they hold no
// content capability — manager or editor — or have no assignments).
export async function getAccessibleSessionIds(
  user: CurrentUser
): Promise<string[] | null> {
  if (user.isAdmin) return null
  if (!hasContentAccess(user)) return []
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
