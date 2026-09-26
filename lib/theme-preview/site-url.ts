// Server-only. The URL the Theme Studio preview / Design Studio renderer
// fetches: the operator's content_jobs.preview_url override (e.g. a Vercel
// preview before DNS cutover), else the canonical site.config.ts siteUrl on
// MAIN. Never client input.
import { createServerClient } from '@/lib/supabase/server'
import { MAIN_BRANCH, readSiteConfigSiteUrl } from '@/lib/github/repo-files'

export async function getPreviewSiteUrl(args: { jobId: string; githubRepo: string }): Promise<string | null> {
  const supabase = createServerClient()
  const { data: job, error } = await supabase
    .from('content_jobs')
    .select('preview_url')
    .eq('id', args.jobId)
    .maybeSingle()
  // Never silently fall back to the MAIN siteUrl on a DB error: before DNS
  // cutover that is the client's OLD live site. Callers map throws to 5xx.
  if (error) throw new Error(`content_jobs preview_url read failed: ${error.message}`)
  return job?.preview_url ?? (await readSiteConfigSiteUrl(args.githubRepo, MAIN_BRANCH))
}
