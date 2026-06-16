// Deterministic technology-stack detection from the crawled homepage HTML,
// response headers, and script/link sources. Heuristic, best-effort — every
// field is null/empty when no signal is found. No external calls, no AI.
import * as cheerio from 'cheerio'
import type { CrawledPage, TechStackIntelligence } from '../types'

interface Signal {
  re: RegExp
  label: string
}

// CMS / page builders detected from markup + asset paths.
const CMS_SIGNALS: Signal[] = [
  { re: /wp-content|wp-includes|wordpress/i, label: 'WordPress' },
  { re: /cdn\.shopify\.com|shopify/i, label: 'Shopify' },
  { re: /squarespace/i, label: 'Squarespace' },
  { re: /wix\.com|wixstatic/i, label: 'Wix' },
  { re: /webflow/i, label: 'Webflow' },
  { re: /drupal/i, label: 'Drupal' },
  { re: /joomla/i, label: 'Joomla' },
  { re: /ghost(\.io|-cms)/i, label: 'Ghost' },
  { re: /hubspot|hs-scripts/i, label: 'HubSpot CMS' },
]

const PAGE_BUILDER_SIGNALS: Signal[] = [
  { re: /elementor/i, label: 'Elementor' },
  { re: /et-pb|divi/i, label: 'Divi' },
  { re: /wpbakery|js_composer/i, label: 'WPBakery' },
  { re: /beaver-builder|fl-builder/i, label: 'Beaver Builder' },
  { re: /oxygen-/i, label: 'Oxygen' },
  { re: /bricks-/i, label: 'Bricks' },
]

const FRAMEWORK_SIGNALS: Signal[] = [
  { re: /\/_next\/|__NEXT_DATA__/i, label: 'Next.js' },
  { re: /data-reactroot|react-dom|_reactListening/i, label: 'React' },
  { re: /\/_nuxt\/|__NUXT__/i, label: 'Nuxt' },
  { re: /data-v-[0-9a-f]{8}|__vue__/i, label: 'Vue' },
  { re: /wire:id|livewire/i, label: 'Livewire' },
  { re: /ng-version|angular/i, label: 'Angular' },
  { re: /gatsby/i, label: 'Gatsby' },
  { re: /astro-island|astro\//i, label: 'Astro' },
  { re: /jquery/i, label: 'jQuery' },
  { re: /alpine|x-data=/i, label: 'Alpine.js' },
]

// Hosting/CDN, detected primarily from response headers.
const HOSTING_HEADER_SIGNALS: Array<{ header: string; re?: RegExp; label: string }> = [
  { header: 'x-vercel-id', label: 'Vercel' },
  { header: 'x-nf-request-id', label: 'Netlify' },
  { header: 'cf-ray', label: 'Cloudflare' },
  { header: 'x-github-request-id', label: 'GitHub Pages' },
  { header: 'server', re: /wpengine/i, label: 'WP Engine' },
  { header: 'server', re: /kinsta/i, label: 'Kinsta' },
  { header: 'x-served-by', re: /fastly/i, label: 'Fastly' },
  { header: 'server', re: /cloudfront/i, label: 'AWS CloudFront' },
  { header: 'x-amz-cf-id', label: 'AWS CloudFront' },
]

// Known risky/notable third-party dependencies worth flagging to a client.
// These regexes only DETECT patterns in an audited site's markup; this module
// never executes any of them.
const RISK_SIGNALS: Signal[] = [
  { re: /polyfill\.io|cdn\.polyfill\.com/i, label: 'polyfill.io script (2024 supply-chain compromise — remove)' },
  { re: /document\.write\(/i, label: 'Uses document.write() (blocks rendering)' },
  { re: /eval\(/i, label: 'Inline eval() detected' },
]

function firstMatch(signals: Signal[], hay: string): string | null {
  for (const s of signals) if (s.re.test(hay)) return s.label
  return null
}

function allMatches(signals: Signal[], hay: string): string[] {
  const out: string[] = []
  for (const s of signals) if (s.re.test(hay)) out.push(s.label)
  return out
}

function detectHosting(headers: Record<string, string>): string | null {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  for (const sig of HOSTING_HEADER_SIGNALS) {
    const val = lower[sig.header]
    if (val === undefined) continue
    if (!sig.re || sig.re.test(val)) return sig.label
  }
  return null
}

/** Detect the stack from crawled pages. Uses the homepage (first page) as the
 * primary source, plus all pages' header signals for hosting/CDN. Pure. */
export function detectTechStack(pages: CrawledPage[]): TechStackIntelligence {
  const home = pages[0]
  const html = home?.html ?? ''
  const $ = html ? cheerio.load(html) : null

  // Build a haystack of asset references + generator meta from the homepage.
  const generator = $?.('meta[name="generator"]').attr('content') ?? ''
  const xGenerator = home?.response_headers
    ? Object.entries(home.response_headers).find(([k]) => k.toLowerCase() === 'x-generator')?.[1] ?? ''
    : ''
  const assetRefs: string[] = []
  if ($) {
    $('script[src]').each((_, el) => {
      const src = $(el).attr('src')
      if (src) assetRefs.push(src)
    })
    $('link[href]').each((_, el) => {
      const href = $(el).attr('href')
      if (href) assetRefs.push(href)
    })
  }
  const hay = `${generator} ${xGenerator} ${assetRefs.join(' ')} ${html.slice(0, 200_000)}`

  const cms = firstMatch(CMS_SIGNALS, hay) || (generator ? generator.split(' ')[0] : null)
  const pageBuilder = firstMatch(PAGE_BUILDER_SIGNALS, hay)
  const frameworks = allMatches(FRAMEWORK_SIGNALS, hay)
  const hosting = detectHosting(home?.response_headers ?? {})

  // Risk flags scan every page's HTML (a risky script may sit off the homepage).
  const riskSet = new Set<string>()
  for (const p of pages) {
    for (const flag of allMatches(RISK_SIGNALS, p.html ?? '')) riskSet.add(flag)
  }

  return {
    cms,
    page_builder: pageBuilder,
    hosting,
    frameworks,
    risk_flags: [...riskSet],
    commentary: '', // filled by the narrative layer
  }
}
