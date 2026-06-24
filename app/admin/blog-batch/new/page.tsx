import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds, hasCapability } from '@/lib/auth/access'
import type { SessionSchema } from '@/types/session-schema'
import NewBatchFlow, { type ClientOption } from './NewBatchFlow'

export default async function NewBlogBatchPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (!hasCapability(user, 'manager')) redirect('/admin/dashboard')

  const supabase = createServerClient()
  const allowed = await getAccessibleSessionIds(user)

  // Eligible clients have a content job with a provisioned repo and published
  // content (phase >= 6) — the precondition the drafting pipeline enforces.
  const { data: jobs } = await supabase
    .from('content_jobs')
    .select('session_id, github_repo, phase')
    .not('github_repo', 'is', null)
    .gte('phase', 6)

  let sessionIds = [...new Set((jobs ?? []).map((j) => j.session_id))]
  if (allowed !== null) {
    const allowedSet = new Set(allowed)
    sessionIds = sessionIds.filter((id) => allowedSet.has(id))
  }

  const { data: sessions } = sessionIds.length
    ? await supabase
        .from('sessions')
        .select('id, website_url, schema_data, status')
        .in('id', sessionIds)
        .neq('status', 'archived')
    : { data: [] }

  const clients: ClientOption[] = (sessions ?? [])
    .map((s) => ({
      id: s.id,
      websiteUrl: s.website_url,
      firmName: ((s.schema_data ?? {}) as SessionSchema).business?.name ?? null,
    }))
    .sort((a, b) => (a.firmName ?? a.websiteUrl).localeCompare(b.firmName ?? b.websiteUrl))

  return <NewBatchFlow clients={clients} />
}
