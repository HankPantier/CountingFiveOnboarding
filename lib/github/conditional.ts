import { RequestError } from '@octokit/request-error'

// Conditional-request cache for GitHub reads. A 304 (Not Modified) response does
// NOT count against the primary rate limit, so routing hot, mostly-unchanged
// reads (editor status/tree polls, deploy-status) through an ETag revalidation
// dramatically lowers baseline quota burn. The cache is a module-level Map, so
// it persists across requests within a warm Node/Fluid instance and is simply
// cold on a fresh one (correctness never depends on it — a miss just re-fetches).

type Entry = { etag: string; data: unknown }

const store = new Map<string, Entry>()

type ConditionalResponse<T> = { status: number; headers: { etag?: string }; data: T }

// Run a GitHub read as a conditional request. `fn` receives request headers to
// spread into the Octokit call and must return the Octokit response. On a 304
// (whether Octokit returns it as a response or throws it), the cached body is
// returned; on a 200 the fresh body is cached by its ETag and returned.
export async function conditionalGet<T>(
  key: string,
  fn: (headers: Record<string, string>) => Promise<ConditionalResponse<T>>
): Promise<T> {
  const cached = store.get(key)
  const reqHeaders: Record<string, string> = cached ? { 'if-none-match': cached.etag } : {}
  try {
    const res = await fn(reqHeaders)
    if (res.status === 304 && cached) return cached.data as T
    if (res.headers?.etag) store.set(key, { etag: res.headers.etag, data: res.data })
    return res.data
  } catch (err) {
    // Some Octokit versions surface a 304 as a thrown RequestError rather than a
    // normal response — treat it the same and serve the cached body.
    if (err instanceof RequestError && err.status === 304 && cached) return cached.data as T
    throw err
  }
}
