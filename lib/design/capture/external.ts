// Server-only. Screenshot an EXTERNAL site (inspiration / competitor / the
// client's current site) via the ScrapingBee screenshot API — arbitrary
// third-party pages never load in our own browser (which runs beside our
// secrets). SSRF-checked before we spend a ScrapingBee credit; the returned
// bytes are magic-byte verified and re-encoded to WebP (strips metadata).
import { fileTypeFromBuffer } from 'file-type'
import { isUrlPubliclyFetchable } from '@/lib/audit/ssrf-guard'
import { toWebp } from '@/lib/design/storage'

export type ExternalCapture = { ok: true; webp: Buffer; width: number; height: number } | { ok: false; reason: string }

const SCRAPINGBEE_API = 'https://app.scrapingbee.com/api/v1/'
const TIMEOUT_MS = 45_000
const MAX_URL_LENGTH = 300
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp'])
// A screenshot response should be a few MB at most; cap so a hostile or
// misbehaving upstream can't stream unbounded data into memory. Mirrors
// lib/audit/crawl.ts's MAX_BINARY_BYTES stream-and-abort convention.
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024

// Reads a fetch Response body up to MAX_CAPTURE_BYTES, aborting the stream as
// soon as the cap is exceeded. Checks Content-Length first so an oversized
// response never gets its body read at all. `url` is the target site's URL
// (never the ScrapingBee request URL, which carries the API key) — safe to log.
async function readCappedBody(res: Response, url: string): Promise<Buffer | null> {
  const contentLength = res.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_CAPTURE_BYTES) {
    console.warn(`[design-capture] ScrapingBee screenshot response too large for ${url}`)
    return null
  }
  const reader = res.body?.getReader()
  if (!reader) {
    const ab = await res.arrayBuffer().catch(() => null)
    if (!ab || ab.byteLength > MAX_CAPTURE_BYTES) return null
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
        if (total > MAX_CAPTURE_BYTES) {
          await reader.cancel().catch(() => {})
          console.warn(`[design-capture] ScrapingBee screenshot response too large for ${url}`)
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

async function attempt(key: string, url: string, stealth: boolean): Promise<Buffer | null> {
  const params = new URLSearchParams({
    api_key: key,
    url,
    screenshot: 'true',
    window_width: '1440',
    window_height: '900',
    render_js: 'true',
    block_ads: 'true',
    wait: '1500',
  })
  if (stealth) params.set('stealth_proxy', 'true')
  try {
    const res = await fetch(`${SCRAPINGBEE_API}?${params.toString()}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) {
      console.warn(`[design-capture] ScrapingBee screenshot failed for ${url}: HTTP ${res.status}${stealth ? ' (stealth)' : ''}`)
      return null
    }
    return await readCappedBody(res, url)
  } catch (err) {
    console.warn(`[design-capture] ScrapingBee screenshot error for ${url}:`, err)
    return null
  }
}

export async function captureExternalScreenshot(rawUrl: string): Promise<ExternalCapture> {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' }
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'Only http(s) URLs can be captured.' }
  if (u.username || u.password) return { ok: false, reason: 'URLs with credentials are not allowed.' }
  if (rawUrl.length > MAX_URL_LENGTH) return { ok: false, reason: 'That URL is too long.' }

  const key = process.env.SCRAPINGBEE_API_KEY
  if (!key) return { ok: false, reason: 'Screenshot capture is not configured.' }
  if (!(await isUrlPubliclyFetchable(u.toString()))) return { ok: false, reason: 'That URL is not publicly reachable.' }

  let bytes = await attempt(key, u.toString(), false)
  let type = bytes ? await fileTypeFromBuffer(bytes) : undefined
  if (!bytes || !type || !IMAGE_MIMES.has(type.mime)) {
    bytes = await attempt(key, u.toString(), true)
    type = bytes ? await fileTypeFromBuffer(bytes) : undefined
  }
  if (!bytes || !type || !IMAGE_MIMES.has(type.mime)) return { ok: false, reason: 'Could not capture a screenshot of that site.' }

  const { webp, width, height } = await toWebp(bytes)
  return { ok: true, webp, width, height }
}
