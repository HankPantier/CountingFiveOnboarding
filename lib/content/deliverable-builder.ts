import type { Database } from '@/types/database'

type GeneratedPage = Database['public']['Tables']['generated_pages']['Row']

export type CtaInfo = { text: string; url: string }

function pageFilename(url: string): string {
  // /services/virtual-cfo-advisory → services--virtual-cfo-advisory.md
  const slug = url.replace(/^\//, '').replace(/\//g, '--') || 'home'
  return `${slug}.md`
}

function originOf(websiteUrl: string): string {
  return websiteUrl.replace(/\/$/, '')
}

// Always derive from page_url so the path matches the convention documented in
// og-images/README.md regardless of whether the LLM produced a clean url_slug.
function ogImageUrl(websiteUrl: string, pageUrl: string): string {
  const slug = pageUrl.replace(/^\//, '').replace(/\//g, '--') || 'home'
  return `${originOf(websiteUrl)}/og-images/${slug}.png`
}

export function buildPageMarkdown(
  page: GeneratedPage,
  firmName: string,
  options: {
    websiteUrl: string
    cta?: CtaInfo | null
    jsonLd?: string
  }
): string {
  const secondaryKw = (page.secondary_keywords as string[]) ?? []
  const eeatSignals = (page.eeat_signals as string[]) ?? []
  const internalLinks = (page.internal_links as Array<{ url: string; anchor_text: string; reason: string }>) ?? []
  const faqBlock = (page.faq_block as Array<{ question: string; answer: string }>) ?? []
  const ogImage = ogImageUrl(options.websiteUrl, page.page_url)
  const cta = options.cta ?? null

  let md = `---
title: ${page.page_title} | ${firmName}
url: ${page.page_url}
meta_title: ${page.meta_title ?? page.page_title}
meta_description: ${page.meta_description ?? ''}
target_keyword: ${page.target_keyword ?? ''}
secondary_keywords: [${secondaryKw.join(', ')}]
canonical_url: ${page.canonical_url ?? ''}
schema_markup: ${page.schema_markup_type ?? 'WebPage'}
og_title: ${page.meta_title ?? page.page_title}
og_description: ${page.meta_description ?? ''}
og_image: ${ogImage}
twitter_card: summary_large_image
${cta ? `cta_text: ${cta.text}\ncta_url: ${cta.url}` : ''}hero: ${page.hero_block ?? 'page-header'}
${page.hero_variant ? `hero_variant: ${page.hero_variant}\n` : ''}${page.hero_image ? `hero_image: ${page.hero_image}\n` : ''}---

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

  if (cta) {
    md += `\n**Call to Action:** [${cta.text}](${cta.url})\n`
  }

  if (options.jsonLd) {
    md += `\n---\n## Structured Data — paste into \`<head>\`\n\n\`\`\`html\n${options.jsonLd}\n\`\`\`\n`
  }

  return md
}

export function buildAllPageFiles(
  pages: GeneratedPage[],
  firmName: string,
  options: {
    websiteUrl: string
    ctaByUrl: Map<string, CtaInfo | null>
    jsonLdByUrl: Map<string, string>
  }
): Array<{ filename: string; content: string }> {
  return pages
    .filter(p => p.generation_status === 'complete' && p.content_markdown)
    .map(p => ({
      filename: pageFilename(p.page_url),
      content: buildPageMarkdown(p, firmName, {
        websiteUrl: options.websiteUrl,
        cta: options.ctaByUrl.get(p.page_url) ?? null,
        jsonLd: options.jsonLdByUrl.get(p.page_url),
      }),
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

// Appends FAQ block to content_markdown with annotation comment.
// Inserts before closing cta-banner/form blocks if present; otherwise appends at end.
export function appendFaqBlock(page: GeneratedPage): string {
  const content = page.content_markdown ?? ''
  if (!content) return ''

  // Defensively parse faq_block as Array<{ question: string; answer: string }>
  const raw = page.faq_block
  if (!raw || !Array.isArray(raw)) return content
  const items = raw.filter((it): it is { question: string; answer: string } =>
    it != null &&
    typeof it === 'object' &&
    typeof (it as { question?: unknown }).question === 'string' &&
    typeof (it as { answer?: unknown }).answer === 'string'
  )
  if (items.length === 0) return content

  // Build FAQ section
  const headline = `Frequently Asked Questions About ${page.page_title}`
  const faqMarkdown = items
    .map(({ question, answer }) => `**Q: ${question}**\nA: ${answer}`)
    .join('\n\n')
  const faqSection = `<!-- block: faq-accordion -->\n## ${headline}\n\n${faqMarkdown}`

  // Find the last cta-banner or form block annotation
  const ctaBannerMatch = content.match(/^<!-- block: cta-banner/m)
  const formMatch = content.match(/^<!-- block: form/m)
  const lastBlockMatch = ctaBannerMatch || formMatch
  let lastBlockIndex = -1

  if (ctaBannerMatch) {
    const idx = content.lastIndexOf('<!-- block: cta-banner')
    lastBlockIndex = idx >= 0 ? idx : -1
  }
  if (formMatch) {
    const idx = content.lastIndexOf('<!-- block: form')
    lastBlockIndex = Math.max(lastBlockIndex, idx)
  }

  // Insert before the last block if found; otherwise append at end
  if (lastBlockIndex >= 0) {
    // Find the start of the line containing the block annotation
    const lineStart = content.lastIndexOf('\n', lastBlockIndex - 1) + 1
    return content.slice(0, lineStart) + faqSection + '\n\n' + content.slice(lineStart)
  } else {
    return content + '\n\n' + faqSection
  }
}
