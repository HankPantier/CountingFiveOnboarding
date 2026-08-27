import { createServerClient } from '@/lib/supabase/server'

// A session is "content-ready" once its content job has reached phase 6 with a
// GitHub repo set — the same gate the content editor uses to allow editing
// (app/admin/content/[id]/edit/page.tsx). Site Owners may only be assigned a
// content-ready session, and the owner picker lists only these.
export async function contentReadySessionIds(sessionIds: string[]): Promise<Set<string>> {
  if (sessionIds.length === 0) return new Set<string>()
  const supabase = createServerClient()
  const { data } = await supabase
    .from('content_jobs')
    .select('session_id, phase, github_repo')
    .in('session_id', sessionIds)

  const ready = new Set<string>()
  for (const job of data ?? []) {
    if ((job.phase ?? 0) >= 6 && job.github_repo) ready.add(job.session_id)
  }
  return ready
}
