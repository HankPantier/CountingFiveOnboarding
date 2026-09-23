import { RequestError } from '@octokit/request-error'

// Shared GitHub rate-limit handling. GitHub returns 403/429 with a "rate limit"
// message when a primary or SECONDARY rate limit trips. Secondary limits fire
// on bursts of mutative requests — exactly what bulk seeding and the content
// push do (hundreds of createBlob calls).

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isRateLimited(err: unknown): err is RequestError {
  return (
    err instanceof RequestError &&
    (err.status === 403 || err.status === 429) &&
    /rate limit/i.test(err.message)
  )
}

// Marks a GitHub call as rate-limit-sensitive. Retrying is owned by ONE layer:
// the Octokit throttling plugin configured in ./app-client (bounded to a single
// retry of at most MAX_RATE_LIMIT_WAIT_S). This wrapper used to retry up to 6
// times with backoff ON TOP of the plugin's own retries, so one call could stall
// for many minutes; it now passes straight through and lets a limit that the
// plugin gave up on surface (callers like edit-stats degrade softly on it).
export async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  return fn()
}
