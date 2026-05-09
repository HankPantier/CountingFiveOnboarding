type SitemapPage = { url: string; title: string; parent?: string; status: string }

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildSitemapXml(websiteUrl: string, sitemap: SitemapPage[]): string {
  const origin = websiteUrl.replace(/\/$/, '')
  const today = new Date().toISOString().slice(0, 10)
  const seen = new Set<string>()

  const urls: string[] = []
  for (const page of sitemap) {
    if (!page?.url) continue
    const path = page.url.startsWith('/') ? page.url : `/${page.url}`
    const loc = origin + path
    if (seen.has(loc)) continue
    seen.add(loc)
    urls.push(
      `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n  </url>`
    )
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`
}
