// Google `site:` index check via the existing Serper integration (same
// endpoint/auth as lib/content/resource-idea-generator.ts). audit.py left this
// to a human; we automate it. Degrades to 'unverified' when SERPER_API_KEY is
// absent or the call fails.
//
// Note: the free Serper tier returns only the default result page (~10) and no
// total-results field, so `google_index_count` is a lower bound. It is
// display-only — it does not affect any score.
import type { IndexCheckResult } from './types'

const SERPER_API = 'https://google.serper.dev/search'
const SERPER_TIMEOUT_MS = 15_000

const UNVERIFIED: IndexCheckResult = { google_index_count: 'unverified', google_indexed_urls: [] }

export async function checkGoogleIndex(domain: string): Promise<IndexCheckResult> {
  if (!process.env.SERPER_API_KEY) return UNVERIFIED
  try {
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
      // No `num` — values other than the default are rejected on free accounts.
      body: JSON.stringify({ q: `site:${domain}`, gl: 'us' }),
      signal: AbortSignal.timeout(SERPER_TIMEOUT_MS),
    })
    if (!res.ok) return UNVERIFIED
    const data = (await res.json()) as { organic?: Array<{ link?: string }> }
    const urls = Array.from(
      new Set(
        (data.organic ?? [])
          .map((o) => o.link?.replace(/\/$/, ''))
          .filter((l): l is string => !!l),
      ),
    )
    return { google_index_count: urls.length, google_indexed_urls: urls }
  } catch {
    return UNVERIFIED
  }
}
