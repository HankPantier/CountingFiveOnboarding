// Server-only. The URL the Theme Studio preview / Design Studio renderer
// fetches: the operator's content_jobs.preview_url override (e.g. a Vercel
// preview before DNS cutover), else the canonical site.config.ts siteUrl on
// MAIN. Never client input.
import { createServerClient } from '@/lib/supabase/server'
import { MAIN_BRANCH, readSiteConfigSiteUrl } from '@/lib/github/repo-files'

export async function getPreviewSiteUrl(args: { jobId: string; githubRepo: string }): Promise<string | null> {
  const supabase = createServerClient()
  const { data: job } = await supabase.from('content_jobs').select('preview_url').eq('id', args.jobId).single()
  return job?.preview_url ?? (await readSiteConfigSiteUrl(args.githubRepo, MAIN_BRANCH))
}
