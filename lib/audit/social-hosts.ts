// Shared social/local host recognition: the canonical social-host list, the
// Google Business Profile / Maps URL matcher, and a URL→platform classifier.
// Consumed by business-signals (harvest), the social-presence intelligence pass,
// and the audit→session draft, so the three never drift on what counts as a
// social link or a GBP listing.
import type { SocialPlatform } from '@/types/audit-result'

/** Bare social hosts matched by exact host or subdomain. GBP is matched
 * separately via GBP_URL_RE — its listings are path/subdomain shapes, not a
 * single host. */
export const SOCIAL_HOSTS = [
  'facebook.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
  'yelp.com',
] as const

/** Google Business Profile / Google Maps listing URL forms. A GBP listing is
 * rarely a bare host, so this matches the path/subdomain shapes it takes. */
export const GBP_URL_RE =
  /(?:google\.[^/]+\/maps|maps\.google\.|maps\.app\.goo\.gl|goo\.gl\/maps|g\.page|business\.google\.)/i

const HOST_PLATFORM: Array<[RegExp, SocialPlatform]> = [
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)facebook\.com$/, 'facebook'],
  [/(^|\.)(twitter|x)\.com$/, 'x'],
  [/(^|\.)youtube\.com$/, 'youtube'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)pinterest\.com$/, 'pinterest'],
  [/(^|\.)yelp\.com$/, 'yelp'],
]

/** Best-effort platform for a URL. GBP is checked first (it never has a bare
 * social host). Unrecognized or unparsable URLs return 'other'. */
export function classifyPlatform(url: string): SocialPlatform {
  if (GBP_URL_RE.test(url)) return 'google_business'
  try {
    const host = new URL(url).host.toLowerCase().replace(/^www\./, '')
    for (const [re, platform] of HOST_PLATFORM) if (re.test(host)) return platform
  } catch {
    // unparsable → 'other'
  }
  return 'other'
}

/** True for a social profile link or a GBP/Maps listing URL. */
export function isSocialUrl(href: string): boolean {
  if (GBP_URL_RE.test(href)) return true
  try {
    const host = new URL(href).host.toLowerCase().replace(/^www\./, '')
    return SOCIAL_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))
  } catch {
    return false
  }
}
