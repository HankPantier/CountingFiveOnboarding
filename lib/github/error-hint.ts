import { RequestError } from '@octokit/request-error'

// Enrich a GitHub API error for display to an admin. A 403 "Resource not
// accessible by integration" on a write endpoint means the GitHub App lacks
// Contents: Read & Write on the repo (or the repo isn't in its installation
// scope) — surface that instead of the raw octokit string.
export function githubErrorMessage(err: unknown, repo: string): string {
  const base = err instanceof Error ? err.message : 'GitHub request failed'
  if (err instanceof RequestError) {
    // Rate-limit responses are ALSO 403, so check them before the permission
    // case or a throttle would be misreported as a permissions problem.
    if (/rate limit/i.test(err.message)) {
      return 'GitHub rate limit reached — wait a couple of minutes and try again.'
    }
    // Genuine permission denial (Contents write missing / repo out of scope).
    if (err.status === 403 && /not accessible by integration/i.test(err.message)) {
      return `${base} — the GitHub App needs "Contents: Read & Write" on ${repo} (and the repo must be in its installation scope).`
    }
  }
  return base
}
