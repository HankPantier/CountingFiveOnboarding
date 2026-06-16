// Domain age via WHOIS, modeled on lib/whois/lookup.ts but pure (returns data,
// no DB write). Non-fatal: any failure yields null fields. `last_updated` comes
// from the freshest sitemap <lastmod>, not WHOIS.
import { whoisDomain, firstResult } from 'whoiser'
import type { DomainIntelligence, SitemapInfo } from '../types'

const WHOIS_TIMEOUT_MS = 8000
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function freshestLastmod(sitemap: SitemapInfo): string | null {
  let best: Date | null = null
  let bestRaw: string | null = null
  for (const entry of sitemap.page_entries ?? []) {
    const d = parseDate(entry.lastmod)
    if (d && (!best || d > best)) {
      best = d
      bestRaw = entry.lastmod
    }
  }
  return bestRaw
}

export async function detectDomainAge(
  domain: string,
  sitemap: SitemapInfo,
): Promise<DomainIntelligence> {
  const last_updated = freshestLastmod(sitemap)
  let registered: string | null = null
  let age_years: number | null = null

  try {
    const cleanDomain = domain
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .split('/')[0]
    const result = await whoisDomain(cleanDomain, { timeout: WHOIS_TIMEOUT_MS })
    const first = firstResult(result)
    registered =
      (first?.['Created Date'] as string) ?? (first?.['Creation Date'] as string) ?? null
    const created = parseDate(registered)
    if (created) {
      age_years = Math.floor((Date.now() - created.getTime()) / MS_PER_YEAR)
    }
  } catch (err) {
    console.warn('[audit-intelligence] WHOIS lookup failed for', domain, err)
  }

  return { registered, age_years, last_updated }
}
