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
import { after } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { MAIN_BRANCH, readSiteConfigSiteUrl } from '@/lib/github/repo-files'
import { deriveVercelPreviewUrl } from './vercel-alias'

export type PreviewUrlSource = 'override' | 'vercel' | 'config'
export type ResolvedPreviewUrl = { url: string | null; source: PreviewUrlSource }

// Per-repo, in-process memo of lookups, both ways, for DERIVE_RETRY_MS:
// - a miss (no Vercel project yet, App lacks access, nothing verified) is not
//   retried, since the deploy-status poll and every capability read would
//   otherwise repeat 3+ GitHub calls and a site fetch;
// - a hit is remembered, so a failed cache write to content_jobs doesn't
//   re-run the lookup on every 8 s deploy-status poll (only the cheap write
//   is retried).
export const DERIVE_RETRY_MS = 10 * 60_000
const failedAt = new Map<string, number>()
const found = new Map<string, { url: string; at: number }>()
const inflight = new Map<string, Promise<string | null>>()

export function __resetPreviewUrlCacheForTests(): void {
  failedAt.clear()
  found.clear()
  inflight.clear()
}

// The verified Vercel address for a repo, memoized (see above) and shared
// between concurrent callers. Never throws.
export async function lookupVercelPreviewUrl(githubRepo: string, now: number = Date.now()): Promise<string | null> {
  const hit = found.get(githubRepo)
  if (hit && now - hit.at < DERIVE_RETRY_MS) return hit.url
  const last = failedAt.get(githubRepo)
  if (last !== undefined && now - last < DERIVE_RETRY_MS) return null
  let pending = inflight.get(githubRepo)
  if (!pending) {
    pending = deriveVercelPreviewUrl(githubRepo)
      .then((url) => {
        if (url) {
          found.set(githubRepo, { url, at: now })
          failedAt.delete(githubRepo)
        } else {
          failedAt.set(githubRepo, now)
        }
        return url
      })
      .finally(() => inflight.delete(githubRepo))
    inflight.set(githubRepo, pending)
  }
  return pending
}

// Look up the Vercel address and, once verified, cache it into
// content_jobs.preview_url — only while that column is still null, so an
// operator's override that lands meanwhile is never clobbered. Returns the
// verified URL (even if the cache write failed) or null. Never throws.
export async function cacheVercelPreviewUrl(args: { jobId: string; githubRepo: string }, now: number = Date.now()): Promise<string | null> {
  const url = await lookupVercelPreviewUrl(args.githubRepo, now)
  if (!url) return null
  const { error } = await createServerClient()
    .from('content_jobs')
    .update({ preview_url: url, updated_at: new Date().toISOString() })
    .eq('id', args.jobId)
    .is('preview_url', null)
  if (error) console.warn(`[preview-url] Could not cache the Vercel address for job ${args.jobId}:`, error.message)
  return url
}

export const DERIVE_DEADLINE_MS = 6_000
const TIMED_OUT = Symbol('timed-out')

async function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms)
  })
  try {
    return await Promise.race([p, deadline])
  } finally {
    clearTimeout(timer)
  }
}

// Keep a timed-out lookup alive past the response (Vercel freezes the
// function otherwise). Outside a request scope (scripts, tests) after()
// throws; the promise then simply runs on in-process.
function keepAliveAfterResponse(task: Promise<unknown>): void {
  try {
    after(() => task.then(() => undefined))
  } catch {
    // not in a request scope
  }
}

// deriveDeadlineMs: how long this request waits on a cold Vercel lookup
// (default DERIVE_DEADLINE_MS). Callers that run under their own, tighter
// overall deadline (the capability read) pass a shorter one.
export type ResolvePreviewOptions = { deriveDeadlineMs?: number }

export async function resolvePreviewSiteUrl(
  args: { jobId: string; githubRepo: string },
  opts: ResolvePreviewOptions = {}
): Promise<ResolvedPreviewUrl> {
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
  // Hot path (Theme shell, render, capability read): the first lookup can be
  // several GitHub calls + a site fetch. Past the deadline, fall back to the
  // siteUrl for THIS request and let the lookup + cache write finish in the
  // background; a timeout is not a miss (never negative-cached), so the next
  // request uses the cached result.
  const task = cacheVercelPreviewUrl(args)
  const derived = await withDeadline(task, opts.deriveDeadlineMs ?? DERIVE_DEADLINE_MS)
  if (derived === TIMED_OUT) keepAliveAfterResponse(task)
  else if (derived) return { url: derived, source: 'vercel' }
  return { url: await readSiteConfigSiteUrl(args.githubRepo, MAIN_BRANCH), source: 'config' }
}

export async function getPreviewSiteUrl(
  args: { jobId: string; githubRepo: string },
  opts: ResolvePreviewOptions = {}
): Promise<string | null> {
  return (await resolvePreviewSiteUrl(args, opts)).url
}

const isVercelAppHost = (url: string): boolean => {
  try {
    return new URL(url).hostname.toLowerCase().endsWith('.vercel.app')
  } catch {
    return false
  }
}

// Is a STORED preview_url the auto-derived Vercel address (cached by
// cacheVercelPreviewUrl) or an operator's own override? Answers from the
// in-memory lookup result only — never waits on GitHub:
// - warm hit: 'vercel' iff it equals the derived alias;
// - warm miss (nothing derivable): 'override';
// - cold: provisionally 'vercel' for a *.vercel.app host, else 'override',
//   and the lookup is refreshed in after() so the next read is exact.
export function classifyStoredPreviewUrl(githubRepo: string, storedUrl: string, now: number = Date.now()): 'vercel' | 'override' {
  const hit = found.get(githubRepo)
  if (hit && now - hit.at < DERIVE_RETRY_MS) return hit.url === storedUrl ? 'vercel' : 'override'
  const last = failedAt.get(githubRepo)
  if (last !== undefined && now - last < DERIVE_RETRY_MS) return 'override'
  keepAliveAfterResponse(lookupVercelPreviewUrl(githubRepo, now))
  return isVercelAppHost(storedUrl) ? 'vercel' : 'override'
}
