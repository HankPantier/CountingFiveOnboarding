// Harvests business/contact data from crawled pages — JSON-LD
// Organization/LocalBusiness entities, tel:/mailto: + inline phone/email, and
// social profile links — aggregated into one BusinessSignals object that seeds
// the AI-drafted session profile (lib/session-draft). Never feeds scoring.
import * as cheerio from 'cheerio'
import type { BusinessSignals, CrawledPage } from './types'

const PHONE_RE = /(\+?1?\s?[(\-.]?\d{3}[)\-.\s]\s?\d{3}[-.\s]\d{4})/g
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
const SOCIAL_HOSTS = [
  'facebook.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
  'yelp.com',
]

const MAX_PER_FIELD = 15

function uniqTrim(values: Iterable<string>, cap = MAX_PER_FIELD): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const v = raw.trim()
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
    if (out.length >= cap) break
  }
  return out
}

function formatAddress(addr: unknown): string | null {
  if (typeof addr === 'string') return addr.trim() || null
  if (addr && typeof addr === 'object') {
    const a = addr as Record<string, unknown>
    const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .map((p) => p.trim())
    return parts.length ? parts.join(', ') : null
  }
  return null
}

interface Harvest {
  orgNames: string[]
  phones: string[]
  emails: string[]
  addresses: string[]
  socials: string[]
}

const ORG_TYPE_RE = /(organization|localbusiness|business|professionalservice|corporation|store)/i

// Walk a parsed JSON-LD value, pulling org-like entities' name/phone/email/
// address/sameAs into the harvest.
function walkJsonLd(node: unknown, h: Harvest): void {
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLd(item, h)
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  if ('@graph' in obj) walkJsonLd(obj['@graph'], h)

  const type = obj['@type']
  const typeStr = Array.isArray(type) ? type.join(' ') : typeof type === 'string' ? type : ''
  const isOrgLike =
    ORG_TYPE_RE.test(typeStr) ||
    'telephone' in obj ||
    'address' in obj ||
    'sameAs' in obj

  if (isOrgLike) {
    if (typeof obj.name === 'string') h.orgNames.push(obj.name)
    if (typeof obj.telephone === 'string') h.phones.push(obj.telephone)
    if (typeof obj.email === 'string') h.emails.push(obj.email)
    const addr = formatAddress(obj.address)
    if (addr) h.addresses.push(addr)
    const sameAs = obj.sameAs
    if (typeof sameAs === 'string') h.socials.push(sameAs)
    else if (Array.isArray(sameAs)) {
      for (const s of sameAs) if (typeof s === 'string') h.socials.push(s)
    }
  }

  // Recurse into nested objects (e.g. department, parentOrganization).
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') walkJsonLd(v, h)
  }
}

function isSocialUrl(href: string): boolean {
  try {
    const host = new URL(href).host.toLowerCase().replace(/^www\./, '')
    return SOCIAL_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))
  } catch {
    return false
  }
}

export function extractBusinessSignals(pages: CrawledPage[]): BusinessSignals {
  const h: Harvest = { orgNames: [], phones: [], emails: [], addresses: [], socials: [] }

  for (const page of pages) {
    const html = page.html
    if (!html) continue

    // JSON-LD entities
    let $: cheerio.CheerioAPI
    try {
      $ = cheerio.load(html)
    } catch {
      continue
    }
    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).text().trim()
      if (!raw) return
      try {
        walkJsonLd(JSON.parse(raw), h)
      } catch {
        // ignore invalid JSON-LD
      }
    })

    // tel:/mailto: + social anchors
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href')
      if (!href) return
      if (href.startsWith('tel:')) h.phones.push(decodeURIComponent(href.slice(4)))
      else if (href.startsWith('mailto:')) h.emails.push(href.slice(7).split('?')[0])
      else if (isSocialUrl(href)) h.socials.push(href.split('?')[0])
    })

    // Inline phone/email in raw HTML
    for (const m of html.matchAll(PHONE_RE)) h.phones.push(m[1])
    for (const m of html.matchAll(EMAIL_RE)) h.emails.push(m[0])
  }

  const orgNames = uniqTrim(h.orgNames)
  return {
    organizationName: orgNames[0] ?? null,
    phones: uniqTrim(h.phones),
    emails: uniqTrim(h.emails.filter(isRealEmail)),
    addresses: uniqTrim(h.addresses),
    socialLinks: uniqTrim(h.socials),
  }
}

// The raw-HTML email sweep can match responsive-image filenames
// (logo@2x.png, hero@mobile.webp). Drop anything ending in an asset extension.
const ASSET_EXT_RE = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|woff2?)$/i
function isRealEmail(email: string): boolean {
  return !ASSET_EXT_RE.test(email) && !/@\d+x/i.test(email)
}
