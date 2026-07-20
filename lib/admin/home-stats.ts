import { createServerClient } from '@/lib/supabase/server'
import {
  getAccessibleSessionIds,
  getAccessibleAuditScope,
  type CurrentUser,
} from '@/lib/auth/access'

export interface HomeStats {
  // Audits still running (not complete and not errored).
  activeAudits: number
  // Onboarding sessions that exist but have no live site yet (no github_repo).
  inProgress: number
  // Clients whose site is set up (a content_job with a provisioned github_repo).
  currentClients: number
}

// Audit statuses that count as "active" — every state except the two terminal
// ones. Expressed as terminal-exclusion so new intermediate statuses (e.g.
// 'researching' from migration 036) are counted without touching this file.
const TERMINAL_AUDIT_STATUSES = ['complete', 'error']

// Three funnel counts for the admin home page, scoped to what the caller may
// see: admins → everything; managers → their assigned sessions; auditors →
// their own audit runs. Uses the service-role client (RLS-bypassing) and
// enforces scope in app code, per the project's access model.
export async function getHomeStats(user: CurrentUser): Promise<HomeStats> {
  const supabase = createServerClient()
  const allowedSessionIds = await getAccessibleSessionIds(user)
  const auditScope = getAccessibleAuditScope(user)

  // Active audits.
  let auditQuery = supabase
    .from('audit_runs')
    .select('*', { count: 'exact', head: true })
    .not('audit_status', 'in', `(${TERMINAL_AUDIT_STATUSES.join(',')})`)
  if (auditScope) auditQuery = auditQuery.eq('created_by', auditScope.createdBy)

  // Clients funnel. Pull accessible non-archived sessions and the set of
  // sessions with a provisioned repo, then partition in app code.
  let sessionQuery = supabase
    .from('sessions')
    .select('id')
    .neq('status', 'archived')
  if (allowedSessionIds !== null) sessionQuery = sessionQuery.in('id', allowedSessionIds)

  let jobQuery = supabase
    .from('content_jobs')
    .select('session_id, github_repo')
    .not('github_repo', 'is', null)
  if (allowedSessionIds !== null) jobQuery = jobQuery.in('session_id', allowedSessionIds)

  const [{ count: activeAudits }, { data: sessions }, { data: jobs }] = await Promise.all([
    auditQuery,
    sessionQuery,
    jobQuery,
  ])

  const withSite = new Set((jobs ?? []).map(j => j.session_id))
  const sessionIds = (sessions ?? []).map(s => s.id)
  const currentClients = sessionIds.filter(id => withSite.has(id)).length

  return {
    activeAudits: activeAudits ?? 0,
    currentClients,
    inProgress: sessionIds.length - currentClients,
  }
}
