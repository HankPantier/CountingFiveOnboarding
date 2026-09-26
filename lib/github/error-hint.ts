import { RequestError } from '@octokit/request-error'

// The curated, safe-to-show explanation for the two GitHub failures an admin
// can act on, or null for anything else. Never includes the raw Octokit text
// (which can carry docs URLs, repo internals or provider detail) — callers
// return this as the public message and log the raw error server-side.
export function githubErrorHint(err: unknown, repo: string): string | null {
  if (!(err instanceof RequestError)) return null
  // Rate-limit responses are ALSO 403, so check them before the permission
  // case or a throttle would be misreported as a permissions problem.
  if (/rate limit/i.test(err.message)) {
    return 'GitHub rate limit reached — wait a couple of minutes and try again.'
  }
  // Genuine permission denial (Contents write missing / repo out of scope).
  if (err.status === 403 && /not accessible by integration/i.test(err.message)) {
    return `GitHub denied access — the GitHub App needs "Contents: Read & Write" on ${repo} (and the repo must be in its installation scope).`
  }
  return null
}

// Enrich a GitHub API error for SERVER LOGS: the curated hint when there is
// one, plus the raw message. Never put this in an HTTP response — use
// githubErrorHint + internalError() there.
export function githubErrorMessage(err: unknown, repo: string): string {
  const base = err instanceof Error ? err.message : 'GitHub request failed'
  const hint = githubErrorHint(err, repo)
  return hint ? `${hint} (${base})` : base
}
