// robots.txt / sitemap.xml / llms.txt fetchers. Ported from audit.py
// fetch_robots, fetch_sitemap, fetch_llms_txt. Each degrades gracefully — a
// failed fetch yields a "not present / not found" result, never a throw.
import * as cheerio from 'cheerio'
import { safeGet } from './crawl'
import type { LlmsResult, RobotsResult, SitemapEntry, SitemapInfo } from './types'

const MAX_CHILD_SITEMAPS = 25

const AI_BOTS = [
  'gptbot',
  'claudebot',
  'perplexitybot',
  'googleother',
  'anthropic-ai',
  'ccbot',
  'chatgpt-user',
]

export async function fetchRobots(baseUrl: string): Promise<RobotsResult> {
  const robotsUrl = new URL('/robots.txt', baseUrl).href
  const result: RobotsResult = {
    present: false,
    sitemaps: [],
    content: '',
    ai_blocked: [],
    ai_allowed: [],
  }
  const r = await safeGet(robotsUrl)
  if (r && r.status === 200) {
    result.present = true
    result.content = r.body
    for (const rawLine of r.body.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (line.toLowerCase().startsWith('sitemap:')) {
        result.sitemaps.push(line.slice(line.indexOf(':') + 1).trim())
      }
    }
    const lower = r.body.toLowerCase()
    for (const bot of AI_BOTS) {
      const idx = lower.indexOf(bot)
      if (idx === -1) continue
      const snippet = lower.slice(idx, idx + 200)
      if (snippet.includes('disallow: /')) result.ai_blocked!.push(bot)
      else result.ai_allowed!.push(bot)
    }
  }
  return result
}

function parseSitemapEntries(xml: string): Array<{ url: string; lastmod: string }> {
  const entries: Array<{ url: string; lastmod: string }> = []
  try {
    const $ = cheerio.load(xml, { xmlMode: true })
    $('url').each((_, el) => {
      const loc = $(el).find('loc').first().text().trim()
      const lastmod = $(el).find('lastmod').first().text().trim()
      if (loc) entries.push({ url: loc, lastmod })
    })
  } catch {
    // parser never throws upward
  }
  return entries
}

export async function fetchSitemap(
  baseUrl: string,
  robotsSitemaps?: string[],
): Promise<SitemapInfo> {
  const defaults = [new URL('/sitemap.xml', baseUrl).href, new URL('/sitemap_index.xml', baseUrl).href]
  const candidates = robotsSitemaps?.length ? [...robotsSitemaps, ...defaults] : defaults

  const result: SitemapInfo = {
    found: false,
    url: null,
    is_index: false,
    child_sitemaps: [],
    count: 0,
    pages: 0,
    posts: 0,
    other: 0,
    page_entries: [],
  }
  const urls: string[] = []

  for (const smUrl of candidates) {
    const r = await safeGet(smUrl)
    if (!r || r.status !== 200) continue
    const ct = r.contentType
    if (!(ct.includes('xml') || r.body.includes('<url>') || r.body.includes('<sitemap>'))) continue

    result.found = true
    result.url = smUrl

    if (r.body.includes('<sitemapindex')) {
      result.is_index = true
      const $ = cheerio.load(r.body, { xmlMode: true })
      const childUrls = $('loc')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(Boolean)
      result.child_sitemaps = childUrls
      // Cap how many child sitemaps we follow — a sitemap index could list
      // thousands, turning one audit into thousands of outbound fetches.
      const childrenToFetch = childUrls.slice(0, MAX_CHILD_SITEMAPS)

      for (const childUrl of childrenToFetch) {
        const cr = await safeGet(childUrl)
        if (!cr || cr.status !== 200) continue
        const entries = parseSitemapEntries(cr.body)
        for (const e of entries) urls.push(e.url)

        const childLower = childUrl.toLowerCase()
        if (
          childLower.includes('post-sitemap') ||
          childLower.includes('article-sitemap') ||
          childLower.includes('blog-sitemap')
        ) {
          result.posts += entries.length
        } else if (childLower.includes('page-sitemap')) {
          result.pages += entries.length
          for (const e of entries) {
            result.page_entries.push({ url: e.url, lastmod: e.lastmod, type: 'page' })
          }
        } else {
          result.other += entries.length
        }
      }
    } else {
      const entries = parseSitemapEntries(r.body)
      for (const e of entries) {
        urls.push(e.url)
        result.page_entries.push({ url: e.url, lastmod: e.lastmod, type: 'page' } satisfies SitemapEntry)
      }
      result.pages = entries.length
    }

    result.count = urls.length
    break
  }

  return result
}

export async function fetchLlmsTxt(baseUrl: string): Promise<LlmsResult> {
  const url = new URL('/llms.txt', baseUrl).href
  const r = await safeGet(url)
  const present = r !== null && r.status === 200
  return {
    present,
    url,
    content: present && r ? r.body.slice(0, 500) : '',
  }
}
