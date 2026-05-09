// Shared helpers for traversing and slugifying sitemap entries. Used by the
// llms-builder, json-ld-builder, parser, and any future consumer that needs to
// reason about the proposed/confirmed sitemap structure.

export type SitemapNode = { url: string; title: string; parent?: string }

export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Walk the parent chain for a URL, capped to guard against accidental cycles
// in user-edited sitemaps. Returns the chain root-first.
export function parentChain<T extends SitemapNode>(
  url: string,
  byUrl: Map<string, T>,
  maxDepth = 8
): T[] {
  const chain: T[] = []
  let cur: T | undefined = byUrl.get(url)
  while (cur && chain.length < maxDepth) {
    chain.unshift(cur)
    if (!cur.parent || cur.parent === '/') break
    cur = byUrl.get(cur.parent)
  }
  return chain
}

// Depth from root (0 = top-level / unparented, 1 = first child, etc.).
export function depthOf(url: string, parentByUrl: Map<string, string | undefined>, maxDepth = 8): number {
  let d = 0
  let cur = parentByUrl.get(url)
  while (cur && d < maxDepth) {
    d++
    cur = parentByUrl.get(cur)
  }
  return d
}

// Group sitemap pages by section title. Top-level pages that have children
// become section headers; everything else becomes Other.
export function groupBySection<T extends SitemapNode>(pages: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  const topLevel = pages.filter(p => !p.parent || p.parent === '/')
  const children = pages.filter(p => p.parent && p.parent !== '/')
  const parentUrls = new Set(children.map(c => c.parent!))

  for (const page of topLevel) {
    if (parentUrls.has(page.url)) {
      groups.set(page.title, children.filter(c => c.parent === page.url))
    }
  }

  const assigned = new Set([...groups.values()].flat().map(p => p.url))
  const standalone = topLevel.filter(p => !parentUrls.has(p.url) && p.url !== '/')
  if (standalone.length > 0) groups.set('Other', standalone)

  return groups
}
