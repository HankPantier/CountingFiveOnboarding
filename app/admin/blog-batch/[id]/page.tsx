import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds, hasCapability } from '@/lib/auth/access'
import type { SessionSchema } from '@/types/session-schema'
import BlogBatchProgress from './BlogBatchProgress'
import type { ClientOption } from '../new/NewBatchFlow'

export default async function BlogBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (!hasCapability(user, 'manager')) redirect('/admin/dashboard')

  const { id } = await params
  const supabase = createServerClient()
  const allowed = await getAccessibleSessionIds(user)

  // Eligible clients to offer for "Add clients": published, repo-linked sites
  // (phase >= 6) not already in this batch, scoped to what the user can access.
  const { data: jobs } = await supabase
    .from('content_jobs')
    .select('session_id, github_repo, phase')
    .not('github_repo', 'is', null)
    .gte('phase', 6)

  let sessionIds = [...new Set((jobs ?? []).map((j) => j.session_id))]
  if (allowed !== null) {
    const allowedSet = new Set(allowed)
    sessionIds = sessionIds.filter((sid) => allowedSet.has(sid))
  }

  const { data: existing } = await supabase
    .from('blog_batch_targets')
    .select('session_id')
    .eq('batch_id', id)
  const inBatch = new Set((existing ?? []).map((t) => t.session_id))
  sessionIds = sessionIds.filter((sid) => !inBatch.has(sid))

  const { data: sessions } = sessionIds.length
    ? await supabase
        .from('sessions')
        .select('id, website_url, schema_data, status')
        .in('id', sessionIds)
        .neq('status', 'archived')
    : { data: [] }

  const eligibleClients: ClientOption[] = (sessions ?? [])
    .map((s) => ({
      id: s.id,
      websiteUrl: s.website_url,
      firmName: ((s.schema_data ?? {}) as SessionSchema).business?.name ?? null,
    }))
    .sort((a, b) => (a.firmName ?? a.websiteUrl).localeCompare(b.firmName ?? b.websiteUrl))

  // Per-client access scoping is enforced by the /status endpoint (managers get
  // a filtered view or 403).
  return <BlogBatchProgress batchId={id} isAdmin={user.isAdmin} eligibleClients={eligibleClients} />
}
