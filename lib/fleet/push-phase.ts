import type { DeployState, DraftMerge, DraftPreflight } from './remote'

// The live side of `fleet-sync --apply`, one repo at a time. Its rules:
//  - Fail fast. After the FIRST remote failure (the draft pre-merge conflicts,
//    the push is rejected, the main→draft merge fails, or Vercel reports
//    failure / error / timeout / no status on a deployable repo), no further
//    repo is pushed unless keepGoing is set.
//  - Canary. The first `canary` repos must reach Vercel `success` before any
//    other repo is pushed. A failed canary stops the run even with keepGoing.
//  - Isolation. A throw inside one repo becomes that repo's failure and never
//    aborts the loop, so the caller can always write its report.
// Every side effect goes through `ops`, so the tests drive it with fakes or
// with real throwaway repos.

export interface PushItem {
  slug: string
  dir: string
  /** The repo has no Vercel project (clients.json noDeploy). A missing status is then expected. */
  noDeploy: boolean
}

export interface PushOps {
  draftPreflight: (dir: string) => DraftPreflight
  pushMain: (dir: string) => { ok: boolean; sha: string; err?: string }
  mergeDraft: (slug: string) => { result: DraftMerge; detail: string }
  waitDeploy: (slug: string, sha: string) => Promise<{ state: DeployState | 'timeout'; url: string | null }>
  /** Throw away the local sync commit of a repo that will not be pushed. */
  resetLocal: (dir: string) => void
}

export interface PushOptions {
  keepGoing: boolean
  canary: number
  /** Wait for Vercel on every repo (canaries always wait). */
  deployWait: boolean
}

export type PushStatus = 'pushed' | 'blocked' | 'failed' | 'skipped'

export interface PushResult {
  slug: string
  status: PushStatus
  canary: boolean
  /** Where it stopped: preflight | push | draft | deploy | exception | stopped. */
  stage?: string
  reason?: string
  main?: string
  draft?: { result: DraftMerge; detail: string }
  deploy?: { state: string; url: string | null }
}

export interface PushPhaseResult {
  results: PushResult[]
  /** The repo whose failure stopped the fleet, or null. */
  stoppedBy: string | null
}

// Put the noDeploy repos last so they are never a canary: they can't prove a deploy.
export function orderForCanary<T extends { noDeploy: boolean }>(items: T[]): T[] {
  return [...items.filter((i) => !i.noDeploy), ...items.filter((i) => i.noDeploy)]
}

export async function runPushPhase(
  items: PushItem[],
  opts: PushOptions,
  ops: PushOps,
  log: (line: string) => void = () => {}
): Promise<PushPhaseResult> {
  const ordered = orderForCanary(items)
  const results: PushResult[] = []
  let stoppedBy: string | null = null

  for (let i = 0; i < ordered.length; i++) {
    const item = ordered[i]
    const canary = i < opts.canary
    if (stoppedBy) {
      try {
        ops.resetLocal(item.dir)
      } catch {
        // best effort: the clone is disposable
      }
      results.push({ slug: item.slug, status: 'skipped', canary, stage: 'stopped', reason: `not pushed — fleet stopped after ${stoppedBy}` })
      continue
    }

    let r: PushResult
    try {
      r = await pushOne(item, canary, opts, ops)
    } catch (err) {
      r = { slug: item.slug, status: 'failed', canary, stage: 'exception', reason: (err as Error).message.split('\n')[0] }
    }
    results.push(r)
    log(describe(r))
    const failed = r.status !== 'pushed'
    if (failed && (canary || !opts.keepGoing)) stoppedBy = item.slug
  }
  return { results, stoppedBy }
}

async function pushOne(item: PushItem, canary: boolean, opts: PushOptions, ops: PushOps): Promise<PushResult> {
  const base = { slug: item.slug, canary }
  const pre = ops.draftPreflight(item.dir)
  if (!pre.ok) {
    ops.resetLocal(item.dir)
    return { ...base, status: 'blocked', stage: 'preflight', reason: pre.reason }
  }
  const push = ops.pushMain(item.dir)
  if (!push.ok) {
    ops.resetLocal(item.dir)
    return { ...base, status: 'failed', stage: 'push', reason: push.err ?? 'push rejected' }
  }
  const out: PushResult = { ...base, status: 'pushed', main: push.sha }
  if (pre.draft === 'present') {
    out.draft = ops.mergeDraft(item.slug)
    if (out.draft.result === 'conflict' || out.draft.result === 'failed') {
      return { ...out, status: 'failed', stage: 'draft', reason: `main pushed, but main→draft ${out.draft.result}: ${out.draft.detail}` }
    }
  } else {
    out.draft = { result: 'no-draft', detail: '' }
  }
  if (opts.deployWait || canary) {
    out.deploy = await ops.waitDeploy(item.slug, push.sha)
    const s = out.deploy.state
    const ok = s === 'success' || (s === 'none' && item.noDeploy && !canary)
    if (!ok) {
      const why = s === 'none' ? 'no Vercel status after the grace period (not a noDeploy repo)' : `Vercel ${s}`
      return { ...out, status: 'failed', stage: 'deploy', reason: canary ? `canary: ${why}` : why }
    }
  }
  return out
}

function describe(r: PushResult): string {
  const tag = `${r.canary ? '[canary] ' : ''}${r.slug.split('/').pop()}`
  if (r.status === 'pushed') {
    return `  ✓ ${tag}: main=${r.main?.slice(0, 7)} draft=${r.draft?.result}${r.draft?.detail ? ` ${r.draft.detail}` : ''} vercel=${r.deploy?.state ?? 'not-checked'}${r.deploy?.url ? ` ${r.deploy.url}` : ''}`
  }
  return `  ✗ ${tag}: ${r.status} at ${r.stage} — ${r.reason}`
}
