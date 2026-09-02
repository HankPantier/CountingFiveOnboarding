import * as cheerio from 'cheerio'
import TurndownService from 'turndown'

// Boilerplate that is never article body — stripped before extraction.
const BOILERPLATE =
  'script, style, noscript, nav, footer, header, aside, form, iframe, ' +
  '.sidebar, .widget, .comments, [role="navigation"], [role="banner"], [role="contentinfo"]'

// Readability-style main-content roots, most specific first. Common CMS body
// containers (WordPress/Squarespace/etc.) before the generic fallbacks.
const MAIN_SELECTORS = [
  'main article',
  'article',
  '[role="main"]',
  'main',
  '.entry-content',
  '.post-content',
  '.article-body',
  '.single-content',
  '.blog-post',
]

export interface ExtractedArticle {
  markdown: string
  extractedTitle: string
  extractedMetaFromHtml: string
  // Absolute image URLs referenced by the body, in document order (deduped). The
  // body markdown references these same absolute URLs, so a caller can re-host
  // each and string-replace the URL.
  imageUrls: string[]
}

function absolutize(src: string, baseUrl: string): string | null {
  const s = src.trim()
  if (!s || s.startsWith('data:')) return null
  try {
    return new URL(s, baseUrl).toString()
  } catch {
    return null
  }
}

function makeTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  })
  return td
}

// Extract the main article body from a full HTML page and convert it to markdown
// VERBATIM (no rewriting). Strips nav/footer/boilerplate, picks the most specific
// content root, resolves image srcs to absolute URLs (collected for re-hosting),
// and serializes the rest to markdown. Never throws — a parse failure yields an
// empty result the caller treats as "nothing to import".
export function extractArticleMarkdown(html: string, opts: { baseUrl: string }): ExtractedArticle {
  const empty: ExtractedArticle = {
    markdown: '',
    extractedTitle: '',
    extractedMetaFromHtml: '',
    imageUrls: [],
  }
  if (!html || !html.trim()) return empty

  try {
    const $ = cheerio.load(html)

    const extractedTitle =
      ($('meta[property="og:title"]').attr('content') ?? '').trim() ||
      $('title').first().text().trim() ||
      $('h1').first().text().trim()
    const extractedMetaFromHtml =
      ($('meta[name="description"]').attr('content') ?? '').trim() ||
      ($('meta[property="og:description"]').attr('content') ?? '').trim()

    $(BOILERPLATE).remove()

    let root = $()
    for (const sel of MAIN_SELECTORS) {
      const found = $(sel).first()
      if (found.length && found.text().trim().length > 0) {
        root = found
        break
      }
    }
    if (!root.length) root = $('body').first()
    if (!root.length) return { ...empty, extractedTitle, extractedMetaFromHtml }

    // Resolve image srcs to absolute and collect them; drop images we can't
    // resolve so the body has no dangling <img>.
    const imageUrls: string[] = []
    const seen = new Set<string>()
    root.find('img').each((_, el) => {
      const img = $(el)
      const raw =
        img.attr('src') ||
        img.attr('data-src') ||
        (img.attr('srcset') ?? '').split(',')[0]?.trim().split(/\s+/)[0] ||
        ''
      const abs = absolutize(raw, opts.baseUrl)
      if (!abs) {
        img.remove()
        return
      }
      img.attr('src', abs)
      img.removeAttr('srcset')
      img.removeAttr('data-src')
      if (!seen.has(abs)) {
        seen.add(abs)
        imageUrls.push(abs)
      }
    })

    const innerHtml = root.html() ?? ''
    const markdown = makeTurndown().turndown(innerHtml).trim()

    return { markdown, extractedTitle, extractedMetaFromHtml, imageUrls }
  } catch (err) {
    console.warn('[html-to-markdown] Extraction failed:', err)
    return empty
  }
}
