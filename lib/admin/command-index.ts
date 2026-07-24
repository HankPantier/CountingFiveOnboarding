import { createServerClient } from '@/lib/supabase/server'
import { getAccessibleSessionIds, getAccessibleAuditScope, type CurrentUser } from '@/lib/auth/access'
import type { SessionSchema } from '@/types/session-schema'

export interface ClientEntry {
  id: string
  name: string
  websiteUrl: string
  status: string
  hasSite: boolean
  lastActivityAt: string
}

export interface AuditEntry {
  id: string
  name: string
  status: string
}

export interface CommandIndex {
  clients: ClientEntry[]
  audits: AuditEntry[]
}

// Best display name for a client: the documented business name, falling back to
// the website's hostname so the palette always has something searchable.
// Exported so the home assistant tools resolve clients with the same label.
export function clientName(schema: SessionSchema | null, websiteUrl: string): string {
  const business = schema?.business?.name?.trim()
  if (business) return business
  try {
    return new URL(websiteUrl).hostname.replace(/^www\./, '')
  } catch {
    return websiteUrl
  }
}

// Lightweight, access-scoped index of clients and audits for the home command
// box. Fetched once server-side and reused by both the client-side fuzzy
// palette and the AI command route — never trust a client-supplied list.
export async function getCommandIndex(user: CurrentUser): Promise<CommandIndex> {
  const supabase = createServerClient()
  const allowedSessionIds = await getAccessibleSessionIds(user)
  const auditScope = getAccessibleAuditScope(user)

  let sessionQuery = supabase
    .from('sessions')
    .select('id, website_url, status, schema_data, last_activity_at')
    .neq('status', 'archived')
    .order('last_activity_at', { ascending: false })
  if (allowedSessionIds !== null) sessionQuery = sessionQuery.in('id', allowedSessionIds)

  let auditQuery = supabase
    .from('audit_runs')
    .select('id, domain, site_name, audit_status')
    .order('created_at', { ascending: false })
  if (auditScope) auditQuery = auditQuery.eq('created_by', auditScope.createdBy)

  const [{ data: sessions }, { data: audits }] = await Promise.all([sessionQuery, auditQuery])

  const jobSessionIds = (sessions ?? []).map(s => s.id)
  const { data: jobs } = jobSessionIds.length
    ? await supabase
        .from('content_jobs')
        .select('session_id, github_repo')
        .in('session_id', jobSessionIds)
        .not('github_repo', 'is', null)
    : { data: [] as Array<{ session_id: string; github_repo: string | null }> }
  const withSite = new Set((jobs ?? []).map(j => j.session_id))

  const clients: ClientEntry[] = (sessions ?? []).map(s => ({
    id: s.id,
    name: clientName(s.schema_data as SessionSchema | null, s.website_url),
    websiteUrl: s.website_url,
    status: s.status,
    hasSite: withSite.has(s.id),
    lastActivityAt: s.last_activity_at,
  }))

  const auditEntries: AuditEntry[] = (audits ?? []).map(a => ({
    id: a.id,
    name: a.site_name ?? a.domain,
    status: a.audit_status,
  }))

  return { clients, audits: auditEntries }
}
