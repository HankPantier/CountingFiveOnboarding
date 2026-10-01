import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { DirectiveSnapshot } from '@/types/session-schema'
import { safeGet } from '@/lib/audit/crawl'
import { fetchViaScrapingBee } from '@/lib/audit/scrapingbee'
import { extractArticleMarkdown } from '@/lib/content/html-to-markdown'
import { isValidSnapshotPath, snapshotPrefix } from './directives'

const BUCKET = 'session-assets'
const BLOCKED = new Set([401, 403, 429, 503])
const LINK_RE = /(?<!!)\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)/g

export const countLinks = (markdown: string): number => markdown.match(LINK_RE)?.length ?? 0
export const countWords = (markdown: string): number =>
  markdown.replace(/[#>*_`[\]()!-]/g, ' ').split(/\s+/).filter(Boolean).length

export interface CapturedSnapshot extends DirectiveSnapshot {
  markdown: string
}

// A client page's live HTML: SSRF-guarded direct fetch, escalating to the
// stealth proxy only when the site's WAF blocks us. Null when unreachable.
export async function fetchLiveHtml(url: string): Promise<string | null> {
  const direct = await safeGet(url)
  if (direct && direct.status >= 200 && direct.status < 300) return direct.body
  // Same escalation the crawler uses for WAF-blocked sites; the proxy fetches on
  // its side, so this adds no SSRF surface (the target was already guard-checked
  // by safeGet's first hop being reachable as a public host).
  if (direct && BLOCKED.has(direct.status)) {
    const proxied = await fetchViaScrapingBee(url)
    if (proxied && proxied.status >= 200 && proxied.status < 300) return proxied.body
  }
  return null
}

// Fetches a client's live page and stores its main content as markdown with
// every link intact. The audit crawl does not keep HTML (trimForStorage), so this
// is the only durable copy of the client's exact wording that verbatim
// generation can rely on — even if the old site later changes or goes away.
// Returns null when the page can't be fetched or has no extractable body.
export async function captureSnapshot(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  absoluteUrl: string,
): Promise<CapturedSnapshot | null> {
  const html = await fetchLiveHtml(absoluteUrl)
  if (!html) return null
  const { markdown } = extractArticleMarkdown(html, { baseUrl: absoluteUrl })
  if (!markdown.trim()) return null

  const path = `${snapshotPrefix(sessionId)}${crypto.randomUUID()}.md`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, new Blob([markdown], { type: 'text/markdown' }), { contentType: 'text/markdown', upsert: false })
  if (error) {
    console.error('[page-snapshot] upload failed:', error.message)
    return null
  }
  return { path, capturedAt: new Date().toISOString(), words: countWords(markdown), links: countLinks(markdown), markdown }
}

export async function readSnapshot(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  path: string,
): Promise<string | null> {
  if (!isValidSnapshotPath(path, sessionId)) return null
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) return null
  return data.text()
}
