import type { Database } from '@/types/database'

type GeneratedPage = Database['public']['Tables']['generated_pages']['Row']

function pageFilename(url: string): string {
  // /services/virtual-cfo-advisory → services--virtual-cfo-advisory.md
  const slug = url.replace(/^\//, '').replace(/\//g, '--') || 'home'
  return `${slug}.md`
}

export function buildPageMarkdown(page: GeneratedPage, firmName: string): string {
  const secondaryKw = (page.secondary_keywords as string[]) ?? []
  const eeatSignals = (page.eeat_signals as string[]) ?? []
  const internalLinks = (page.internal_links as Array<{ url: string; anchor_text: string; reason: string }>) ?? []
  const faqBlock = (page.faq_block as Array<{ question: string; answer: string }>) ?? []

  let md = `---
title: ${page.page_title} | ${firmName}
url: ${page.page_url}
meta_title: ${page.meta_title ?? page.page_title}
meta_description: ${page.meta_description ?? ''}
target_keyword: ${page.target_keyword ?? ''}
secondary_keywords: [${secondaryKw.join(', ')}]
canonical_url: ${page.canonical_url ?? ''}
schema_markup: ${page.schema_markup_type ?? 'WebPage'}
---

${page.content_markdown ?? ''}

---
## SEO & AIO Metadata

**Answer Block:**
${page.answer_block ?? ''}

**E-E-A-T Signals:**
${eeatSignals.map(s => `- ${s}`).join('\n') || '- None specified'}

**Internal Links:**
${internalLinks.map(l => `- ${l.anchor_text} → ${l.url} — ${l.reason}`).join('\n') || '- None'}

**FAQ Block:**
${faqBlock.map(f => `\n**Q: ${f.question}**\nA: ${f.answer}`).join('\n') || '\nNone'}

**LLM Citation Note:**
${page.llm_citation_note ?? ''}
`

  return md
}

export function buildAllPageFiles(
  pages: GeneratedPage[],
  firmName: string
): Array<{ filename: string; content: string }> {
  return pages
    .filter(p => p.generation_status === 'complete' && p.content_markdown)
    .map(p => ({
      filename: pageFilename(p.page_url),
      content: buildPageMarkdown(p, firmName),
    }))
}

export function buildErrorsFile(pages: GeneratedPage[]): string | null {
  const errored = pages.filter(p => p.generation_status === 'error')
  if (errored.length === 0) return null

  let md = `# Pages That Need Manual Copy\n\nThe following pages failed during content generation and need manual copywriting:\n\n`
  for (const p of errored) {
    md += `- **${p.page_title}** (${p.page_url})\n`
  }
  return md
}
