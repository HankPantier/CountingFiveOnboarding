import type { Database } from '@/types/database'
import { groupBySection } from './sitemap-utils'

type GeneratedPage = Database['public']['Tables']['generated_pages']['Row']
type SitemapPage = { url: string; title: string; parent?: string; status: string }

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).replace(/\s\S*$/, '') + '...'
}

function asBlockquote(text: string): string {
  return text
    .split('\n')
    .map(line => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n')
}

export function buildLlmsTxt(
  firmName: string,
  brandSummary: string,
  sitemap: SitemapPage[],
  pages: GeneratedPage[]
): string {
  const pageMap = new Map(pages.map(p => [p.page_url, p]))
  const sections = groupBySection(sitemap)

  let txt = `# ${firmName}\n\n${asBlockquote(brandSummary)}\n`

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
  brandFullDoc: string,
  sitemap: SitemapPage[],
  pages: GeneratedPage[]
): string {
  const pageMap = new Map(pages.map(p => [p.page_url, p]))
  const sections = groupBySection(sitemap)

  // Brand doc already starts with "# About <Firm>". Skip the firmName H1 if so,
  // otherwise lead with it.
  const firmH1 = brandFullDoc.startsWith('# ') ? '' : `# ${firmName}\n\n`
  let txt = `${firmH1}${brandFullDoc.trim()}\n\n---\n`

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
