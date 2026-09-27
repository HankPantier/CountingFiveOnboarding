import { spawnSync } from 'node:child_process'
import { git, revParse, tryGit } from './git-local'

// Remote side of a fleet sync — ONLY reached from `fleet-sync --apply` or
// `fleet-sync rollback --apply`. Uses the operator's own `git` + `gh` auth
// (like the rollouts it replaces), not the platform's GitHub App.

export interface GhResult {
  ok: boolean
  status: number | null
  body: string
  err: string
}

// `gh api` with --include so the HTTP status is visible (204 vs 201 vs 409).
export function ghApi(args: string[]): GhResult {
  const r = spawnSync('gh', ['api', '--include', ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const out = r.stdout ?? ''
  const m = out.match(/^HTTP\/[\d.]+ (\d{3})/)
  const split = out.indexOf('\r\n\r\n') >= 0 ? out.indexOf('\r\n\r\n') + 4 : out.indexOf('\n\n') + 2
  return { ok: r.status === 0, status: m ? Number(m[1]) : null, body: split > 1 ? out.slice(split) : out, err: r.stderr ?? '' }
}

export function ghJson<T>(pathAndQuery: string): T | null {
  const r = spawnSync('gh', ['api', pathAndQuery], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (r.status !== 0) return null
  try {
    return JSON.parse(r.stdout) as T
  } catch {
    return null
  }
}

// Fast-forward push of the local commit to main. Never forced.
export function pushMain(dir: string): { ok: boolean; sha: string; err?: string } {
  const sha = revParse(dir, 'HEAD')
  const r = tryGit(dir, ['push', '-q', 'origin', 'HEAD:refs/heads/main'])
  if (!r.ok) return { ok: false, sha, err: r.err.trim().split('\n').slice(-2).join(' ') }
  git(dir, ['fetch', '-q', '--depth', '1', 'origin', '+refs/heads/main:refs/remotes/origin/main'])
  return { ok: true, sha }
}

export type DraftPreflight = { ok: true; draft: 'present' | 'absent' } | { ok: false; reason: string }

// BEFORE main is pushed: fetch draft and trial-merge the local sync commit into
// it (`git merge-tree --write-tree`, no working tree touched). The later
// main→draft merge through the API merges exactly this commit, so a conflict
// here means the repo is blocked with nothing pushed. The clone is unshallowed
// first so the merge base is real.
export function draftPreflight(dir: string): DraftPreflight {
  const ls = tryGit(dir, ['ls-remote', '--exit-code', 'origin', 'refs/heads/draft'])
  if (ls.code === 2) return { ok: true, draft: 'absent' }
  if (!ls.ok) return { ok: false, reason: `cannot read origin draft: ${ls.err.trim().split('\n')[0]}` }
  const shallow = tryGit(dir, ['rev-parse', '--is-shallow-repository']).out.trim() === 'true'
  const fetch = tryGit(dir, [
    'fetch',
    '-q',
    ...(shallow ? ['--unshallow'] : []),
    'origin',
    '+refs/heads/main:refs/remotes/origin/main',
    '+refs/heads/draft:refs/remotes/origin/draft',
  ])
  if (!fetch.ok) return { ok: false, reason: `fetching draft failed: ${fetch.err.trim().split('\n')[0]}` }
  const m = tryGit(dir, ['merge-tree', '--write-tree', '--name-only', '--no-messages', 'HEAD', 'refs/remotes/origin/draft'])
  if (m.ok) return { ok: true, draft: 'present' }
  if (m.code === 1) {
    const files = m.out.trim().split('\n').slice(1).filter(Boolean)
    return { ok: false, reason: `main→draft would conflict (${files.join(', ') || 'unknown files'}) — resolve draft first; nothing was pushed` }
  }
  return { ok: false, reason: `draft trial merge failed: ${m.err.trim().split('\n')[0]}` }
}

export type DraftMerge = 'merged' | 'up-to-date' | 'no-draft' | 'conflict' | 'failed'

// Merge main → draft through the GitHub merges API (keeps the editor's draft
// branch current so the next content publish doesn't conflict or revert).
export function mergeMainIntoDraft(slug: string, message: string): { result: DraftMerge; detail: string } {
  const r = ghApi(['-X', 'POST', `repos/${slug}/merges`, '-f', 'base=draft', '-f', 'head=main', '-f', `commit_message=${message}`])
  if (r.status === 201) {
    let sha = ''
    try {
      sha = (JSON.parse(r.body || '{}') as { sha?: string }).sha ?? ''
    } catch {
      // merged; the body just wasn't parseable
    }
    return { result: 'merged', detail: sha.slice(0, 7) }
  }
  if (r.status === 204) return { result: 'up-to-date', detail: '' }
  if (r.status === 404) return { result: 'no-draft', detail: 'no draft branch' }
  if (r.status === 409) return { result: 'conflict', detail: 'merge conflict — resolve main→draft by hand' }
  return { result: 'failed', detail: `${r.status ?? '?'} ${r.err.trim() || r.body.slice(0, 200)}` }
}

export type DeployState = 'success' | 'failure' | 'error' | 'pending' | 'none'

interface CombinedStatus {
  statuses?: { context: string; state: string; target_url?: string | null }[]
}

export function vercelState(slug: string, ref: string): { state: DeployState; url: string | null } {
  const s = ghJson<CombinedStatus>(`repos/${slug}/commits/${ref}/status`)
  const v = s?.statuses?.find((x) => /^vercel/i.test(x.context))
  if (!v) return { state: 'none', url: null }
  const state = (['success', 'failure', 'error', 'pending'] as const).find((x) => x === v.state) ?? 'pending'
  return { state, url: v.target_url ?? null }
}

// Poll the commit's Vercel status. 'none' after `noStatusGraceMs` = the repo
// has no Vercel project (e.g. korbey) — reported, not waited on forever.
export async function waitForVercel(
  slug: string,
  sha: string,
  opts: { timeoutMs?: number; intervalMs?: number; noStatusGraceMs?: number } = {}
): Promise<{ state: DeployState | 'timeout'; url: string | null }> {
  const timeout = opts.timeoutMs ?? 12 * 60_000
  const interval = opts.intervalMs ?? 15_000
  const grace = opts.noStatusGraceMs ?? 3 * 60_000
  const start = Date.now()
  for (;;) {
    const v = vercelState(slug, sha)
    if (v.state === 'success' || v.state === 'failure' || v.state === 'error') return v
    const elapsed = Date.now() - start
    if (v.state === 'none' && elapsed > grace) return v
    if (elapsed > timeout) return { state: 'timeout', url: v.url }
    await new Promise((r) => setTimeout(r, interval))
  }
}

// ── rollback ────────────────────────────────────────────────────────────────

export interface FleetCommit {
  sha: string
  subject: string
  trailer: string
  reverted: boolean
}

// The newest fleet-sync commit on origin/main (needs history: deepens the clone).
export function findLastFleetCommit(dir: string, trailer: string): FleetCommit | null {
  git(dir, ['fetch', '-q', '--depth', '60', 'origin', '+refs/heads/main:refs/remotes/origin/main'])
  const log = git(dir, ['log', 'refs/remotes/origin/main', '-n', '60', '--format=%H%x1f%s%x1f%B%x1e'])
  const commits = log
    .split('\x1e')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [sha, subject, body] = c.split('\x1f')
      return { sha, subject, body: body ?? '' }
    })
  const idx = commits.findIndex((c) => new RegExp(`^${trailer}: `, 'm').test(c.body))
  if (idx < 0) return null
  const hit = commits[idx]
  const trailerLine = hit.body.split('\n').find((l) => l.startsWith(`${trailer}: `)) ?? ''
  const reverted = commits.slice(0, idx).some((c) => c.body.includes(`This reverts commit ${hit.sha}`) || c.body.includes(`Fleet-Rollback: ${hit.sha}`))
  return { sha: hit.sha, subject: hit.subject, trailer: trailerLine, reverted }
}
