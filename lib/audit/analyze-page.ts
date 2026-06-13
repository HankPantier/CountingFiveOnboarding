// Per-page HTML analysis (cheerio). Ported from audit.py analyze_page,
// count_words, flesch_kincaid_grade. Pure: takes a CrawledPage, returns a
// PageAnalysis. Never throws.
import * as cheerio from 'cheerio'
import type { CheerioAPI } from 'cheerio'
import readability from 'text-readability'
import type { CrawledPage, PageAnalysis } from './types'

/** audit.py count_words — \b\w+\b token count. */
export function countWords(text: string): number {
  if (!text) return 0
  return (text.match(/\b\w+\b/g) ?? []).length
}

/** audit.py flesch_kincaid_grade — via text-readability (textstat parity). */
export function fleschKincaidGrade(text: string): number | null {
  try {
    return readability.fleschKincaidGrade(text)
  } catch {
    return null
  }
}

const LAZY_ANCHORS = new Set([
  'click here',
  'here',
  'read more',
  'learn more',
  'more',
  'link',
])

const CTA_RE =
  /\b(contact us|get started|book a|schedule a|request a|sign up|free trial|get a quote|call us|let's talk|try free|start free)\b/i
const TRUST_RE =
  /\b(testimonial|review|case study|certified|award|accredited|years of experience|clients|guarantee|trusted)\b/i
const PHONE_RE = /(\+?1?\s?[(\-.]?\d{3}[)\-.\s]\s?\d{3}[-.\s]\d{4})/
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/
const MIXED_CONTENT_RE =
  /(?:src|href)=["'](http:\/\/[^"']+\.(?:js|css|jpg|jpeg|png|gif|svg|woff|woff2)[^"']*)["']/gi

function extractSchemaTypes(obj: unknown): string[] {
  const types: string[] = []
  if (Array.isArray(obj)) {
    for (const item of obj) types.push(...extractSchemaTypes(item))
  } else if (obj && typeof obj === 'object') {
    const rec = obj as Record<string, unknown>
    if ('@graph' in rec) types.push(...extractSchemaTypes(rec['@graph']))
    const t = rec['@type']
    if (Array.isArray(t)) types.push(...(t.filter((x) => typeof x === 'string') as string[]))
    else if (typeof t === 'string' && t) types.push(t)
  }
  return types
}

/** Find a <meta> whose name attribute equals `name` (case-insensitive). */
function metaByName($: CheerioAPI, name: string): string | null {
  let value: string | null = null
  $('meta[name]').each((_, el) => {
    if (value !== null) return
    const attr = $(el).attr('name')
    if (attr && attr.toLowerCase() === name) value = $(el).attr('content') ?? ''
  })
  return value
}

function hasMetaName($: CheerioAPI, name: string): boolean {
  return metaByName($, name) !== null
}

export function analyzePage(page: CrawledPage): PageAnalysis {
  const html = page.html
  const url = page.url
  const $ = cheerio.load(html)

  // ── Meta / SEO ──────────────────────────────────────────────────────────
  const title = ($('title').first().text() ?? '').trim()
  const metaDescRaw = metaByName($, 'description')
  const metaDesc = (metaDescRaw ?? '').trim()
  const canonical = ($('link[rel="canonical"]').first().attr('href') ?? '').trim()
  const robotsContent = metaByName($, 'robots')
  const noindex = robotsContent !== null && robotsContent.toLowerCase().includes('noindex')

  // ── Headings ────────────────────────────────────────────────────────────
  const headings: Record<string, string[]> = {}
  for (let level = 1; level <= 6; level++) {
    headings[`h${level}`] = $(`h${level}`)
      .map((_, el) => $(el).text().trim())
      .get()
  }
  const h1Count = headings.h1.length
  let headingSkip = false
  let lastLevel = 0
  for (let level = 1; level <= 6; level++) {
    if (headings[`h${level}`].length) {
      if (lastLevel > 0 && level > lastLevel + 1) headingSkip = true
      lastLevel = level
    }
  }

  // ── Images ──────────────────────────────────────────────────────────────
  const images = $('img')
  const imgsTotal = images.length
  let imgsMissingAlt = 0
  images.each((_, el) => {
    if (!$(el).attr('alt')) imgsMissingAlt++
  })

  // ── Open Graph / Twitter Card ─────────────────────────────────────────────
  const ogTitle = $('meta[property="og:title"]').length > 0
  const ogDesc = $('meta[property="og:description"]').length > 0
  const ogImage = $('meta[property="og:image"]').length > 0
  const twCard = hasMetaName($, 'twitter:card')
  const twTitle = hasMetaName($, 'twitter:title')
  const twImage = hasMetaName($, 'twitter:image')

  const viewport = hasMetaName($, 'viewport')

  // ── Schema / JSON-LD ──────────────────────────────────────────────────────
  const schemaTypes: string[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim() || '{}'
    try {
      schemaTypes.push(...extractSchemaTypes(JSON.parse(raw)))
    } catch {
      schemaTypes.push('__invalid_json__')
    }
  })

  // ── Links (lazy anchor text) ───────────────────────────────────────────────
  let lazyAnchors = 0
  $('a[href]').each((_, el) => {
    const t = $(el).text().trim().toLowerCase()
    if (LAZY_ANCHORS.has(t)) lazyAnchors++
  })

  // ── Content text (strip script/style/nav/footer/header) ────────────────────
  const $body = cheerio.load(html)
  $body('script, style, nav, footer, header').remove()
  const bodyText = ($body('body').length ? $body('body').text() : $body.root().text())
    .replace(/\s+/g, ' ')
    .trim()
  const wordCount = countWords(bodyText)
  const fkGrade = wordCount > 50 ? fleschKincaidGrade(bodyText.slice(0, 2000)) : null

  const hasCta = CTA_RE.test(bodyText)
  const hasTrust = TRUST_RE.test(bodyText)
  const hasPhone = PHONE_RE.test(html)
  const hasEmail = EMAIL_RE.test(html)

  // ── Analytics detection ────────────────────────────────────────────────────
  const hasGa4 = /(gtag|G-[A-Z0-9]+|googletagmanager\.com\/gtag)/.test(html)
  const hasGtm = /(GTM-[A-Z0-9]+|googletagmanager\.com\/ns\.html)/.test(html)
  const hasMetaPx = /(fbq\(|connect\.facebook\.net)/.test(html)
  const hasLinkedin = /(linkedin\.com\/insight|_linkedin_partner)/.test(html)
  const hasHotjar = /(hotjar\.com|hj\()/.test(html)
  const hasClarity = /clarity\.ms/.test(html)

  // ── Mixed content ──────────────────────────────────────────────────────────
  const mixedRaw: string[] = []
  for (const m of html.matchAll(MIXED_CONTENT_RE)) mixedRaw.push(m[1])
  const mixedContentUrls = [...new Set(mixedRaw)].slice(0, 20)

  // ── Security headers ───────────────────────────────────────────────────────
  const rh = page.response_headers ?? {}
  const secHeaders: Record<string, boolean> = {
    'content-security-policy': !!rh['content-security-policy'],
    'x-frame-options': !!rh['x-frame-options'],
    'x-content-type-options': !!rh['x-content-type-options'],
    'referrer-policy': !!rh['referrer-policy'],
    'permissions-policy': !!(rh['permissions-policy'] || rh['feature-policy']),
  }
  const secHeaderCount = Object.values(secHeaders).filter(Boolean).length

  // ── ARIA / accessibility basics ────────────────────────────────────────────
  let buttonsMissingLabel = 0
  $('button').each((_, el) => {
    const $el = $(el)
    if (!$el.attr('aria-label') && !$el.text().trim()) buttonsMissingLabel++
  })
  let inputsMissingLabel = 0
  $('input').each((_, el) => {
    const $el = $(el)
    const type = $el.attr('type')
    // audit.py excludes hidden/submit/button and untyped inputs.
    if (type === undefined || ['hidden', 'submit', 'button'].includes(type)) return
    const id = $el.attr('id')
    if (id && $(`label[for="${id}"]`).length) return
    if (!$el.attr('aria-label') && !$el.attr('aria-labelledby')) inputsMissingLabel++
  })

  let hasSkipNav = false
  $('a').each((_, el) => {
    if (hasSkipNav) return
    if (/skip/i.test($(el).text())) hasSkipNav = true
  })

  // ── URL quality ────────────────────────────────────────────────────────────
  let urlHasParams = false
  let urlHasCaps = false
  try {
    const parsed = new URL(url)
    urlHasParams = !!parsed.search && parsed.search !== '?'
    urlHasCaps = parsed.pathname !== parsed.pathname.toLowerCase()
  } catch {
    // leave defaults
  }

  const pageTextSample = bodyText.slice(0, 3000)

  return {
    title,
    title_len: title.length,
    meta_desc: metaDesc,
    meta_desc_len: metaDesc.length,
    canonical,
    noindex,
    h1_count: h1Count,
    h1_texts: headings.h1,
    h2_count: headings.h2.length,
    headings,
    heading_skip: headingSkip,
    imgs_total: imgsTotal,
    imgs_missing_alt: imgsMissingAlt,
    og_title: ogTitle,
    og_desc: ogDesc,
    og_image: ogImage,
    tw_card: twCard,
    tw_title: twTitle,
    tw_image: twImage,
    viewport,
    schema_types: schemaTypes,
    schema_valid: !schemaTypes.includes('__invalid_json__'),
    word_count: wordCount,
    fk_grade: fkGrade,
    has_cta: hasCta,
    has_trust: hasTrust,
    has_phone: hasPhone,
    has_email: hasEmail,
    has_ga4: hasGa4,
    has_gtm: hasGtm,
    has_meta_px: hasMetaPx,
    has_linkedin: hasLinkedin,
    has_hotjar: hasHotjar,
    has_clarity: hasClarity,
    mixed_content: mixedContentUrls.length > 0,
    mixed_content_urls: mixedContentUrls,
    sec_headers: secHeaders,
    sec_header_count: secHeaderCount,
    lazy_anchors: lazyAnchors,
    url_has_params: urlHasParams,
    url_has_caps: urlHasCaps,
    buttons_missing_label: buttonsMissingLabel,
    inputs_missing_label: inputsMissingLabel,
    has_skip_nav: hasSkipNav,
    page_text_sample: pageTextSample,
    content_length_bytes: page.content_length ?? 0,
    redirect_count: page.redirect_count ?? 0,
  }
}
