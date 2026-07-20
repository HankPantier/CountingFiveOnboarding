import { normalizeInputUrl, normalizeDomain } from './index'

export const MAX_BATCH_URLS = 25

export interface ParsedBatchUrl {
  url: string
  domain: string
}

export interface ParsedBatch {
  valid: ParsedBatchUrl[]
  invalid: string[]
}

// Turn a textarea blob (or a pre-split array) of one-URL-per-line into a
// deduplicated list of normalized, publicly-shaped http(s) URLs. Pure and
// synchronous so it can be unit-tested and reused by the create route; the
// route enforces MAX_BATCH_URLS and the SSRF fetch guard runs later per crawl.
export function parseBatchUrls(input: string | string[]): ParsedBatch {
  const lines = Array.isArray(input) ? input : input.split(/\r?\n/)

  const valid: ParsedBatchUrl[] = []
  const invalid: string[] = []
  const seen = new Set<string>()

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    const normalized = normalizeInputUrl(trimmed)
    let parsed: URL
    try {
      parsed = new URL(normalized)
    } catch {
      invalid.push(trimmed)
      continue
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      invalid.push(trimmed)
      continue
    }

    if (seen.has(normalized)) continue
    seen.add(normalized)
    valid.push({ url: normalized, domain: normalizeDomain(normalized) })
  }

  return { valid, invalid }
}
