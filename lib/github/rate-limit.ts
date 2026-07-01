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

// Wrap a GitHub call so a rate-limit response is waited out and retried rather
// than aborting. Honors the server's retry-after header when present, else
// backs off exponentially. Non-rate-limit errors propagate immediately.
export async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 6
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isRateLimited(err)) throw err
      const retryAfter = Number(err.response?.headers?.['retry-after'])
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? (retryAfter + 1) * 1000
          : Math.min(60_000, 1000 * 2 ** attempt)
      await sleep(waitMs)
    }
  }
}
