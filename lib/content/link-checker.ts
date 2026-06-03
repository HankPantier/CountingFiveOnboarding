export type ExternalLink = { url: string; title?: string }

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_CONCURRENCY = 5

async function checkOne(link: ExternalLink, timeoutMs: number): Promise<boolean> {
  try {
    const head = await fetch(link.url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (head.ok) return true
    // Some servers reject HEAD outright; retry with a ranged GET before
    // declaring the URL dead.
    if (head.status === 405 || head.status === 403 || head.status === 501) {
      const get = await fetch(link.url, {
        method: 'GET',
        redirect: 'follow',
        headers: { Range: 'bytes=0-1024' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      return get.ok
    }
    return false
  } catch {
    return false
  }
}

// Validate candidate external URLs server-side so hallucinated or dead links
// never reach the drafting prompt. Returns only the links that respond 2xx
// (after redirects). Failures are dropped, never thrown.
export async function headCheckUrls(
  links: ExternalLink[],
  opts: { timeoutMs?: number; concurrency?: number } = {}
): Promise<ExternalLink[]> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY

  const candidates = links.filter(
    (l) => typeof l.url === 'string' && /^https?:\/\//i.test(l.url)
  )
  const survivors: ExternalLink[] = []

  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency)
    const results = await Promise.all(batch.map((l) => checkOne(l, timeoutMs)))
    batch.forEach((link, idx) => {
      if (results[idx]) {
        survivors.push(link)
      } else {
        console.warn(`[link-checker] Dropped unreachable URL: ${link.url}`)
      }
    })
  }

  return survivors
}
