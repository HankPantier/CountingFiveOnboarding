// Stealth-proxy fallback for sites whose bot protection (Cloudflare/WAF) blocks a
// direct fetch from our serverless egress IP with a 401/403/429/503 — the site
// loads fine in a browser but refuses cloud IPs. Only the crawler invokes this,
// and only AFTER a direct fetch is blocked, so we pay ScrapingBee's stealth-proxy
// credits solely on sites that actually need it.
//
// Returns a FetchResult shaped exactly like safeGet's so the crawl loop stays
// agnostic to how the HTML was obtained. Returns null when disabled (no key set)
// or the proxy itself failed (bad key, no credits, still blocked upstream) — the
// caller then falls back to its normal error handling.
import type { FetchResult } from './crawl'

const SCRAPINGBEE_API = 'https://app.scrapingbee.com/api/v1/'
// Stealth requests render JS + solve challenges, so they're slow; give them room
// but stay well under the crawl's own budget (the crawl deadline caps the total).
const PROXY_TIMEOUT_MS = 30_000

export function scrapingBeeEnabled(): boolean {
  return !!process.env.SCRAPINGBEE_API_KEY
}

export async function fetchViaScrapingBee(targetUrl: string): Promise<FetchResult | null> {
  const key = process.env.SCRAPINGBEE_API_KEY
  if (!key) return null

  const params = new URLSearchParams({
    api_key: key,
    url: targetUrl,
    // Stealth proxy = residential IPs + anti-bot bypass (renders JS by default),
    // the mode built for Cloudflare/WAF-protected sites.
    stealth_proxy: 'true',
    // We only parse HTML with cheerio — skip images/css/fonts to cut time & cost.
    block_resources: 'true',
  })

  try {
    const res = await fetch(`${SCRAPINGBEE_API}?${params.toString()}`, {
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    })
    // ScrapingBee returns 200 with the page HTML on success; a 4xx/5xx here is a
    // ScrapingBee-side failure (bad key, no credits, upstream still blocked). The
    // upstream target's own status is echoed in Spb-Original-Status.
    if (!res.ok) {
      console.warn(`[scrapingbee] proxy fetch failed for ${targetUrl}: HTTP ${res.status}`)
      return null
    }
    const body = await res.text()
    if (!body) return null

    const originalStatus = Number(res.headers.get('spb-original-status')) || 200
    const resolvedUrl = res.headers.get('spb-resolved-url') || targetUrl
    return {
      // Treat any successful upstream (2xx/3xx that ScrapingBee resolved) as 200
      // so the crawl loop counts it as a real page; surface a genuine 4xx/5xx.
      finalUrl: resolvedUrl,
      status: originalStatus >= 200 && originalStatus < 400 ? 200 : originalStatus,
      headers: {},
      body,
      redirectChain: [],
      contentLength: Buffer.byteLength(body, 'utf8'),
      contentType: res.headers.get('content-type') ?? 'text/html; charset=utf-8',
      sslError: false,
    }
  } catch (err) {
    console.warn(`[scrapingbee] proxy fetch error for ${targetUrl}:`, err)
    return null
  }
}
