// Optional Firecrawl crawl path, used when FIRECRAWL_API_KEY is present;
// otherwise the built-in fetch+cheerio crawler (crawl.ts) is the default.
// Mirrors audit.py's optional Firecrawl handling. Stub for now.
import type { CrawlResult } from './crawl'

/** True when a Firecrawl API key is configured. */
export function firecrawlAvailable(): boolean {
  return !!process.env.FIRECRAWL_API_KEY
}

export async function crawlWithFirecrawl(
  _startUrl: string,
  _maxPages = 50,
): Promise<CrawlResult> {
  throw new Error('crawlWithFirecrawl not implemented')
}
