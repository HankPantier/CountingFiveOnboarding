import { Octokit } from '@octokit/rest'
import { createAppAuth } from '@octokit/auth-app'
import { throttling } from '@octokit/plugin-throttling'

// GitHub enforces a PRIMARY hourly quota AND a SECONDARY rate limit that trips on
// bursts of concurrent/rapid requests — including the editor firing several
// repo-reading routes at once and the content push creating many blobs. The
// throttling plugin is GitHub's recommended handling: it queues requests, caps
// concurrency, spaces mutations, and (via the handlers below) waits out and
// retries both limit types instead of surfacing a 403 to the editor UI.
const ThrottledOctokit = Octokit.plugin(throttling)

let cached: InstanceType<typeof ThrottledOctokit> | null = null

// Upper bound on how long a single GitHub call may wait out a rate limit.
export const MAX_RATE_LIMIT_WAIT_S = 60

export function shouldRetryRateLimit(retryAfterS: number, retryCount: number): boolean {
  return retryCount < 1 && retryAfterS <= MAX_RATE_LIMIT_WAIT_S
}

// PEM private keys span multiple lines. To keep them in a single env var we
// accept either the raw PEM (with real newlines, which is fine for some
// hosting providers) or with literal "\n" sequences that we expand here.
function normalizePrivateKey(raw: string): string {
  if (raw.includes('-----BEGIN') && raw.includes('\n')) return raw
  return raw.replace(/\\n/g, '\n')
}

function readEnv(): {
  appId: string
  privateKey: string
  installationId: number
  org: string
} {
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID
  const org = process.env.GITHUB_ORG
  if (!appId || !privateKey || !installationId || !org) {
    throw new Error(
      'GitHub App not configured. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, ' +
        'GITHUB_APP_INSTALLATION_ID, and GITHUB_ORG.'
    )
  }
  const installationIdNum = Number(installationId)
  if (!Number.isFinite(installationIdNum)) {
    throw new Error('GITHUB_APP_INSTALLATION_ID must be numeric')
  }
  return {
    appId,
    privateKey: normalizePrivateKey(privateKey),
    installationId: installationIdNum,
    org,
  }
}

// Returns a long-lived Octokit instance authenticated as the GitHub App
// installation. @octokit/auth-app handles installation-token minting and
// caching internally (tokens are valid for 1 hour and re-minted as needed),
// so we keep a single Octokit across requests within the same Node process.
export function getOctokit(): InstanceType<typeof ThrottledOctokit> {
  if (cached) return cached
  const { appId, privateKey, installationId } = readEnv()
  cached = new ThrottledOctokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId },
    throttle: {
      // This plugin is the ONE retry layer for GitHub rate limits (withRateLimitRetry
      // in ./rate-limit is a pass-through, so the two never stack). Retry once, and
      // only when the wait is short: a primary-quota reset can be up to an hour
      // away, and a request route must surface that fast rather than hang. Total
      // wait per call is therefore bounded by MAX_RATE_LIMIT_WAIT_S (~60s).
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        const retry = shouldRetryRateLimit(retryAfter, retryCount)
        octokit.log.warn(
          `GitHub primary rate limit on ${options.method} ${options.url} — ${retry ? `retry ${retryCount + 1} in ${retryAfter}s` : 'giving up'}`
        )
        return retry
      },
      onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
        const retry = shouldRetryRateLimit(retryAfter, retryCount)
        octokit.log.warn(
          `GitHub secondary rate limit on ${options.method} ${options.url} — ${retry ? `retry ${retryCount + 1} in ${retryAfter}s` : 'giving up'}`
        )
        return retry
      },
    },
  })
  return cached
}

// Resolve a repo slug like "acmetax-site" or "countingfive/acmetax-site" into
// an { owner, repo } pair. We accept both forms so content_jobs.github_repo
// can store either. If only the repo name is given, owner defaults to GITHUB_ORG.
export function resolveRepo(slug: string): { owner: string; repo: string } {
  const trimmed = slug.trim()
  if (trimmed.includes('/')) {
    const [owner, repo] = trimmed.split('/')
    if (!owner || !repo) throw new Error(`Invalid repo slug: ${slug}`)
    return { owner, repo }
  }
  const { org } = readEnv()
  return { owner: org, repo: trimmed }
}
