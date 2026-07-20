import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// The three lifecycle folders. Order encodes progression: prospect → working →
// client. Auto-transitions only ever move forward (never downgrade); manual
// moves may set any value.
export type AuditGroup = 'prospect' | 'working' | 'client'

export const AUDIT_GROUPS: AuditGroup[] = ['prospect', 'working', 'client']

const RANK: Record<AuditGroup, number> = { prospect: 0, working: 1, client: 2 }

export function isAuditGroup(v: string): v is AuditGroup {
  return v === 'prospect' || v === 'working' || v === 'client'
}

// The most-advanced of a set of groups (client > working > prospect).
export function mostAdvancedGroup(groups: string[]): AuditGroup {
  let best: AuditGroup = 'prospect'
  for (const g of groups) {
    if (isAuditGroup(g) && RANK[g] > RANK[best]) best = g
  }
  return best
}

// Folders strictly below `to` — the only rows a forward-only promotion may move.
// Promoting to 'working' touches only 'prospect' (never downgrades a 'client').
export function groupsBelow(to: AuditGroup): AuditGroup[] {
  return AUDIT_GROUPS.filter((g) => RANK[g] < RANK[to])
}

// Forward-only promotion across every run of a domain owned by the same user.
// Only rows currently in a *lower* folder are moved, so a manually-set (or
// already-further) folder is never downgraded. Folders track the business, so
// all of a domain's re-audits move together. Uses the service-role client.
export async function promoteAuditGroupByDomain(
  supabase: SupabaseClient<Database>,
  { domain, createdBy, to }: { domain: string; createdBy: string | null; to: AuditGroup },
): Promise<void> {
  const lower = groupsBelow(to)
  if (lower.length === 0) return

  let query = supabase
    .from('audit_runs')
    .update({ audit_group: to })
    .eq('domain', domain)
    .in('audit_group', lower)
  // created_by can be null; match nulls explicitly so ownership stays scoped.
  query = createdBy === null ? query.is('created_by', null) : query.eq('created_by', createdBy)

  const { error } = await query
  if (error) console.error('[audit-group] promote failed:', error.message)
}

// The folder a new run for this domain should inherit — the most-advanced folder
// among the same owner's existing runs for the domain, or 'prospect' if none.
export async function resolveInheritedGroup(
  supabase: SupabaseClient<Database>,
  { domain, createdBy }: { domain: string; createdBy: string | null },
): Promise<AuditGroup> {
  let query = supabase.from('audit_runs').select('audit_group').eq('domain', domain)
  query = createdBy === null ? query.is('created_by', null) : query.eq('created_by', createdBy)
  const { data } = await query
  if (!data?.length) return 'prospect'
  return mostAdvancedGroup(data.map((r) => r.audit_group))
}
