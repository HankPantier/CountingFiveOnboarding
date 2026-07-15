// Same-domain BFS crawler (fetch + cheerio). Ported from audit.py crawl_site,
// normalize_url, same_domain, safe_get. Sequential with a polite delay, hard
// cap at maxPages (only 200-OK HTML pages count toward the cap), redirect
// chains followed manually (max 5) so redirect_count is captured, per-page
// errors collected and never thrown.
import * as cheerio from 'cheerio'
import { isUrlPubliclyFetchable } from './ssrf-guard'
import type { CrawledPage, CrawlError, RedirectHop } from './types'

const USER_AGENT = 'Mozilla/5.0 (compatible; RevaltusAudit/1.0; +https://revaltus.com)'
const TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 5
const CRAWL_DELAY_MS = 150
// Cap each response body so a malicious/oversized page can't exhaust memory.
const MAX_BODY_BYTES = 5 * 1024 * 1024
// Soft wall-clock budget for the whole crawl; on a large/slow site we stop and
// score what we have rather than overrun the function's maxDuration (300s) and
// get the row stuck in a running state. Leaves ~60s for PSI/analysis/scoring.
const CRAWL_BUDGET_MS = 240_000

export interface CrawlResult {
  pages: CrawledPage[]
  errors: CrawlError[]
}

const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  'Accept-Language': 'en-US,en;q=0.9',
}

/** audit.py normalize_url — resolve relative/protocol-relative URLs, drop the
 * fragment. Returns null on a URL that cannot be parsed. */
export function normalizeUrl(url: string, base: string): string | null {
  try {
    const resolved = new URL(url.trim(), base)
    resolved.hash = ''
    return resolved.href
  } catch {
    return null
  }
}

/** Mimics Python str.lstrip('www.') — strips leading characters in {w, .}. */
function stripWwwLstrip(host: string): string {
  let i = 0
  while (i < host.length && (host[i] === 'w' || host[i] === '.')) i++
  return host.slice(i)
}

/** audit.py same_domain. */
export function sameDomain(url: string, baseDomain: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase()
    return stripWwwLstrip(host) === stripWwwLstrip(baseDomain.toLowerCase())
  } catch {
    return false
  }
}

export interface FetchResult {
  finalUrl: string
  status: number
  headers: Record<string, string>
  body: string
  redirectChain: RedirectHop[]
  contentLength: number
  contentType: string
  sslError: boolean
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Read a response body as text, but stop after MAX_BODY_BYTES so an oversized
 * or infinite-stream response can't exhaust memory. Returns '' on any error. */
export async function readCappedBody(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return res.text().catch(() => '')
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {})
          break
        }
        chunks.push(value)
      }
    }
  } catch {
    return ''
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

/** audit.py safe_get — follow redirects manually (so we can record the chain),
 * timeout-bounded. Returns null when the request ultimately fails. */
export async function safeGet(startUrl: string): Promise<FetchResult | null> {
  const redirectChain: RedirectHop[] = []
  let currentUrl = startUrl
  let sslError = false

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // SSRF guard: re-validate the initial URL and every redirect target before
    // connecting, so an audited site can't redirect us to internal addresses.
    if (!(await isUrlPubliclyFetchable(currentUrl))) return null

    let res: Response
    try {
      res = await fetch(currentUrl, {
        headers: REQUEST_HEADERS,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      // A TLS/cert failure is the one error worth flagging distinctly; the
      // dedicated SSL check (ssl.ts) measures expiry separately.
      if (err instanceof Error && /certificate|self.signed|tls|ssl/i.test(err.message)) {
        sslError = true
      }
      return null
    }

    const status = res.status
    const location = res.headers.get('location')
    if (status >= 300 && status < 400 && location) {
      redirectChain.push({ url: currentUrl, status })
      const next = normalizeUrl(location, currentUrl)
      if (!next || hop === MAX_REDIRECTS) {
        // Too many redirects or unparseable target — treat as the final hop.
        const body = await readCappedBody(res)
        return {
          finalUrl: currentUrl,
          status,
          headers: headersToObject(res.headers),
          body,
          redirectChain,
          contentLength: Buffer.byteLength(body, 'utf8'),
          contentType: res.headers.get('content-type') ?? '',
          sslError,
        }
      }
      currentUrl = next
      continue
    }

    const body = await readCappedBody(res)
    return {
      finalUrl: res.url || currentUrl,
      status,
      headers: headersToObject(res.headers),
      body,
      redirectChain,
      contentLength: Buffer.byteLength(body, 'utf8'),
      contentType: res.headers.get('content-type') ?? '',
      sslError,
    }
  }
  return null
}

export interface BinaryFetchResult {
  buffer: Buffer
  contentType: string
  finalUrl: string
}

// Binary counterpart of safeGet for fetching an image the server was told to
// download (e.g. a rep-chosen team headshot on a client's live site). Same
// SSRF-guarded manual-redirect loop, but returns raw bytes and only on a final
// 200. Capped so a hostile URL can't stream unbounded data into memory.
const MAX_BINARY_BYTES = 10 * 1024 * 1024

async function readCappedBinary(res: Response): Promise<Buffer | null> {
  const reader = res.body?.getReader()
  if (!reader) {
    const ab = await res.arrayBuffer().catch(() => null)
    if (!ab || ab.byteLength > MAX_BINARY_BYTES) return null
    return Buffer.from(ab)
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > MAX_BINARY_BYTES) {
          await reader.cancel().catch(() => {})
          return null
        }
        chunks.push(value)
      }
    }
  } catch {
    return null
  }
  return Buffer.concat(chunks)
}

export async function safeGetBinary(startUrl: string): Promise<BinaryFetchResult | null> {
  let currentUrl = startUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isUrlPubliclyFetchable(currentUrl))) return null

    let res: Response
    try {
      res = await fetch(currentUrl, {
        headers: REQUEST_HEADERS,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      return null
    }

    const status = res.status
    const location = res.headers.get('location')
    if (status >= 300 && status < 400 && location) {
      await res.body?.cancel().catch(() => {})
      const next = normalizeUrl(location, currentUrl)
      if (!next || hop === MAX_REDIRECTS) return null
      currentUrl = next
      continue
    }

    if (status !== 200) {
      await res.body?.cancel().catch(() => {})
      return null
    }

    const buffer = await readCappedBinary(res)
    if (!buffer) return null
    return {
      buffer,
      contentType: res.headers.get('content-type') ?? '',
      finalUrl: res.url || currentUrl,
    }
  }
  return null
}

/** audit.py crawl_site. `onProgress` (if given) is called with the running
 * page count after each successful page — callers should throttle any I/O. */
export async function crawlSite(
  startUrl: string,
  maxPages = 50,
  onProgress?: (pagesCrawled: number) => void | Promise<void>,
): Promise<CrawlResult> {
  const baseDomain = (() => {
    try {
      return new URL(startUrl).host
    } catch {
      return ''
    }
  })()

  const visited = new Set<string>()
  const queued = new Set<string>([startUrl])
  const queue: string[] = [startUrl]
  const pages: CrawledPage[] = []
  const errors: CrawlError[] = []
  const deadline = Date.now() + CRAWL_BUDGET_MS

  while (queue.length && pages.length < maxPages && Date.now() < deadline) {
    const url = queue.shift() as string
    if (visited.has(url)) continue
    visited.add(url)

    const res = await safeGet(url)
    if (res === null) {
      errors.push({ url, error: 'Request failed' })
      continue
    }

    if (!res.contentType.includes('text/html')) {
      await sleep(CRAWL_DELAY_MS)
      continue
    }

    const page: CrawledPage = {
      url: res.finalUrl,
      original_url: url,
      status_code: res.status,
      redirect_chain: res.redirectChain,
      redirect_count: res.redirectChain.length,
      html: res.body,
      response_headers: res.headers,
      ssl_error: res.sslError,
      content_length: res.contentLength,
    }

    if (res.status === 200) {
      pages.push(page)
      if (onProgress) await onProgress(pages.length)
    } else {
      errors.push({ url, status: res.status, error: `HTTP ${res.status}` })
    }

    // Discover links only from successful HTML pages.
    if (res.status === 200 && pages.length < maxPages) {
      const $ = cheerio.load(res.body)
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href')
        if (!href) return
        if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return
        const full = normalizeUrl(href, url)
        if (full && sameDomain(full, baseDomain) && !visited.has(full) && !queued.has(full)) {
          queued.add(full)
          queue.push(full)
        }
      })
    }

    await sleep(CRAWL_DELAY_MS)
  }

  return { pages, errors }
}
