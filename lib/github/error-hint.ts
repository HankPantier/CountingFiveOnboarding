import { RequestError } from '@octokit/request-error'

// Enrich a GitHub API error for display to an admin. A 403 "Resource not
// accessible by integration" on a write endpoint means the GitHub App lacks
// Contents: Read & Write on the repo (or the repo isn't in its installation
// scope) — surface that instead of the raw octokit string.
export function githubErrorMessage(err: unknown, repo: string): string {
  const base = err instanceof Error ? err.message : 'GitHub request failed'
  if (err instanceof RequestError && err.status === 403) {
    return `${base} — the GitHub App needs "Contents: Read & Write" on ${repo} (and the repo must be in its installation scope).`
  }
  return base
}
