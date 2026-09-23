import { RequestError } from '@octokit/request-error'

// Conditional-request cache for GitHub reads. A 304 (Not Modified) response does
// NOT count against the primary rate limit, so routing hot, mostly-unchanged
// reads (editor status/tree polls, deploy-status) through an ETag revalidation
// dramatically lowers baseline quota burn. The cache is a module-level Map, so
// it persists across requests within a warm Node/Fluid instance and is simply
// cold on a fresh one (correctness never depends on it — a miss just re-fetches).
//
// Bounded as an LRU (Map insertion order = recency) so a long-lived instance that
// touches many repos / commits can't grow it without limit.

type Entry = { etag: string; data: unknown }

export const CONDITIONAL_CACHE_MAX = 500

const store = new Map<string, Entry>()

function touch(key: string, entry: Entry): void {
  store.delete(key)
  store.set(key, entry)
  while (store.size > CONDITIONAL_CACHE_MAX) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

type ConditionalResponse<T> = { status: number; headers: { etag?: string }; data: T }

// Run a GitHub read as a conditional request. `fn` receives request headers to
// spread into the Octokit call and must return the Octokit response. On a 304
// (whether Octokit returns it as a response or throws it), the cached body is
// returned; on a 200 the fresh body is cached by its ETag and returned.
//
// `immutable: true` marks a key addressed by a content hash (a commit or tree
// sha) — its body can never change, so a cache hit is served WITHOUT any
// request at all (not even a free 304 round-trip).
export async function conditionalGet<T>(
  key: string,
  fn: (headers: Record<string, string>) => Promise<ConditionalResponse<T>>,
  options: { immutable?: boolean } = {}
): Promise<T> {
  const cached = store.get(key)
  if (cached && options.immutable) {
    touch(key, cached)
    return cached.data as T
  }
  const reqHeaders: Record<string, string> = cached ? { 'if-none-match': cached.etag } : {}
  try {
    const res = await fn(reqHeaders)
    if (res.status === 304 && cached) {
      touch(key, cached)
      return cached.data as T
    }
    if (res.headers?.etag) {
      touch(key, { etag: res.headers.etag, data: res.data })
    } else if (options.immutable) {
      // No ETag, but a content-addressed body is still safe to reuse forever.
      touch(key, { etag: '', data: res.data })
    }
    return res.data
  } catch (err) {
    // Some Octokit versions surface a 304 as a thrown RequestError rather than a
    // normal response — treat it the same and serve the cached body.
    if (err instanceof RequestError && err.status === 304 && cached) return cached.data as T
    throw err
  }
}

// Test hook: current number of cached entries.
export function conditionalCacheSize(): number {
  return store.size
}
