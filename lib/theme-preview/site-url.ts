// Server-only. The URL the Theme Studio preview / Design Studio renderer
// fetches, in this order:
//   1. content_jobs.preview_url — the operator override, or a Vercel address
//      cached there by step 2;
//   2. the repo's stable Vercel address (https://<project>.vercel.app/),
//      derived from GitHub's Vercel deploy records and verified to carry the
//      Revaltus template marker — then cached into content_jobs.preview_url so
//      the derivation runs once per client;
//   3. site.config.ts siteUrl on MAIN. Before DNS cutover that is the client's
//      OLD site; the shell builders refuse it (no Revaltus marker → 422).
// Never client input.
import { createServerClient } from '@/lib/supabase/server'
import { MAIN_BRANCH, readSiteConfigSiteUrl } from '@/lib/github/repo-files'
import { deriveVercelPreviewUrl } from './vercel-alias'

export type PreviewUrlSource = 'override' | 'vercel' | 'config'
export type ResolvedPreviewUrl = { url: string | null; source: PreviewUrlSource }

// A failed derivation (no Vercel project yet, App lacks access, nothing
// verified) is not retried for a while: the deploy-status poll and every
// capability read would otherwise repeat 3+ GitHub calls and a site fetch.
export const DERIVE_RETRY_MS = 10 * 60_000
const failedAt = new Map<string, number>()
const inflight = new Map<string, Promise<string | null>>()

export function __resetPreviewUrlCacheForTests(): void {
  failedAt.clear()
  inflight.clear()
}

// Derive the Vercel address and, once verified, cache it into
// content_jobs.preview_url — only while that column is still null, so an
// operator's override that lands meanwhile is never clobbered. Returns the
// verified URL (even if the cache write failed) or null. Never throws.
export async function cacheVercelPreviewUrl(args: { jobId: string; githubRepo: string }, now: number = Date.now()): Promise<string | null> {
  const last = failedAt.get(args.githubRepo)
  if (last !== undefined && now - last < DERIVE_RETRY_MS) return null
  let pending = inflight.get(args.githubRepo)
  if (!pending) {
    pending = deriveVercelPreviewUrl(args.githubRepo).finally(() => inflight.delete(args.githubRepo))
    inflight.set(args.githubRepo, pending)
  }
  const url = await pending
  if (!url) {
    failedAt.set(args.githubRepo, now)
    return null
  }
  failedAt.delete(args.githubRepo)
  const { error } = await createServerClient()
    .from('content_jobs')
    .update({ preview_url: url, updated_at: new Date().toISOString() })
    .eq('id', args.jobId)
    .is('preview_url', null)
  if (error) console.warn(`[preview-url] Could not cache the Vercel address for job ${args.jobId}:`, error.message)
  return url
}

export async function resolvePreviewSiteUrl(args: { jobId: string; githubRepo: string }): Promise<ResolvedPreviewUrl> {
  const supabase = createServerClient()
  const { data: job, error } = await supabase
    .from('content_jobs')
    .select('preview_url')
    .eq('id', args.jobId)
    .maybeSingle()
  // Never silently fall back to the MAIN siteUrl on a DB error: before DNS
  // cutover that is the client's OLD live site. Callers map throws to 5xx.
  if (error) throw new Error(`content_jobs preview_url read failed: ${error.message}`)
  if (job?.preview_url) return { url: job.preview_url, source: 'override' }
  const derived = await cacheVercelPreviewUrl(args)
  if (derived) return { url: derived, source: 'vercel' }
  return { url: await readSiteConfigSiteUrl(args.githubRepo, MAIN_BRANCH), source: 'config' }
}

export async function getPreviewSiteUrl(args: { jobId: string; githubRepo: string }): Promise<string | null> {
  return (await resolvePreviewSiteUrl(args)).url
}
