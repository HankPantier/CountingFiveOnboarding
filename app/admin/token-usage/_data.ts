import { createServerClient } from '@/lib/supabase/server'
import {
  summarize,
  byClient,
  byUser,
  byUserClient,
  dailySeries,
  dailySeriesByUser,
  type UsageRow,
  type AuditMeta,
} from '@/lib/tokens/aggregate'

// Shared loader for every Token Usage page (overview + by-user + by-user-client).
// Each page is force-dynamic and re-runs this; at current volume the single 50k
// fetch + in-memory aggregation is fine (a DB-side aggregate view is the scale
// path). Centralized so the three pages stay consistent.
export async function loadTokenUsage() {
  const supabase = createServerClient()

  const [{ data: usage }, { data: sessions }, { data: auditRuns }, { data: admins }] = await Promise.all([
    supabase
      .from('token_usage')
      .select('task, stage, model, input_tokens, output_tokens, session_id, audit_id, created_by, created_at')
      .order('created_at', { ascending: false })
      .range(0, 49999),
    supabase.from('sessions').select('id, website_url'),
    supabase.from('audit_runs').select('id, session_id, site_name, domain'),
    supabase.from('admins').select('id, name, email'),
  ])

  const rows: UsageRow[] = usage ?? []

  const labels: Record<string, string> = {}
  for (const s of sessions ?? []) labels[s.id] = s.website_url ?? s.id

  const audits: Record<string, AuditMeta> = {}
  for (const a of auditRuns ?? []) {
    audits[a.id] = { sessionId: a.session_id, siteName: a.site_name, domain: a.domain }
  }

  // admins.id → display label (name, else email, else raw id) for the by-user views.
  const userLabels: Record<string, string> = {}
  for (const a of admins ?? []) userLabels[a.id] = a.name || a.email || a.id

  const summary = summarize(rows, Date.now())

  return {
    rows,
    labels,
    audits,
    userLabels,
    summary,
    clients: byClient(rows, labels, audits),
    users: byUser(rows, userLabels),
    userClients: byUserClient(rows, userLabels, labels, audits),
    series: {
      all: dailySeries(rows),
      onboarding: dailySeries(rows, 'onboarding'),
      audit: dailySeries(rows, 'audit'),
      content: dailySeries(rows, 'content'),
    },
    userSeries: dailySeriesByUser(rows, userLabels),
  }
}
