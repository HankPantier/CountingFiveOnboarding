import type { Database } from '@/types/database'

type GeneratedPage = Database['public']['Tables']['generated_pages']['Row']
type SitemapPage = { url: string; title: string; parent?: string; status: string }

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).replace(/\s\S*$/, '') + '...'
}

function groupBySection(sitemap: SitemapPage[]): Map<string, SitemapPage[]> {
  const groups = new Map<string, SitemapPage[]>()
  const topLevel = sitemap.filter(p => !p.parent || p.parent === '/')
  const children = sitemap.filter(p => p.parent && p.parent !== '/')
  const parentUrls = new Set(children.map(c => c.parent!))

  for (const page of topLevel) {
    if (parentUrls.has(page.url)) {
      const sectionChildren = children.filter(c => c.parent === page.url)
      groups.set(page.title, sectionChildren)
    }
  }

  // Add standalone pages under "Other"
  const assigned = new Set([...groups.values()].flat().map(p => p.url))
  const standalone = topLevel.filter(p => !parentUrls.has(p.url) && p.url !== '/')
  if (standalone.length > 0) {
    groups.set('Other', standalone)
  }

  return groups
}

export function buildLlmsTxt(
  firmName: string,
  firmDescription: string,
  sitemap: SitemapPage[],
  pages: GeneratedPage[]
): string {
  const pageMap = new Map(pages.map(p => [p.page_url, p]))
  const sections = groupBySection(sitemap)

  let txt = `# ${firmName}\n\n> ${firmDescription}\n`

  for (const [sectionName, sectionPages] of sections) {
    txt += `\n## ${sectionName}\n\n`
    for (const sp of sectionPages) {
      const gen = pageMap.get(sp.url)
      const desc = gen?.meta_description
        ? truncate(gen.meta_description, 80)
        : sp.title
      txt += `- [${sp.title}](${sp.url}): ${desc}\n`
    }
  }

  return txt
}

export function buildLlmsFullTxt(
  firmName: string,
  firmDescription: string,
  sitemap: SitemapPage[],
  pages: GeneratedPage[]
): string {
  const pageMap = new Map(pages.map(p => [p.page_url, p]))
  const sections = groupBySection(sitemap)

  let txt = `# ${firmName}\n\n> ${firmDescription}\n`

  for (const [sectionName, sectionPages] of sections) {
    txt += `\n## ${sectionName}\n`
    for (const sp of sectionPages) {
      const gen = pageMap.get(sp.url)
      txt += `\n### ${sp.title}\n`
      txt += `URL: ${sp.url}\n\n`
      if (gen?.content_markdown) {
        txt += gen.content_markdown
      } else {
        txt += '*Content not yet generated.*'
      }
      txt += '\n\n---\n'
    }
  }

  return txt
}
