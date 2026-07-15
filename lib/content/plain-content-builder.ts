import { Document, Packer, Paragraph, TextRun } from 'docx'
import type { Database } from '@/types/database'

type GeneratedPage = Database['public']['Tables']['generated_pages']['Row']

const DIVIDER = '----------------------------------------'

function completedPagesOf(pages: GeneratedPage[]): GeneratedPage[] {
  return pages.filter(p => p.generation_status === 'complete' && p.content_markdown)
}

function stripInline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}

/**
 * Convert a page's markdown body to styling-free plain text: no headings markers,
 * emphasis markers, inline code ticks, or link syntax — just the words, so the
 * result pastes into any CMS/editor without inheriting formatting.
 */
export function markdownToPlainText(markdown: string): string {
  // Defensive: content_markdown is a raw body, but strip a leading frontmatter
  // block and any fenced code blocks if they ever appear.
  let text = markdown.replace(/^\s*---\n[\s\S]*?\n---\s*\n?/, '')
  text = text.replace(/```[\s\S]*?```/g, '')

  const out: string[] = []
  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed) {
      out.push('')
    } else if (/^#{1,6}\s+/.test(trimmed)) {
      out.push(stripInline(trimmed.replace(/^#{1,6}\s+/, '')))
    } else if (/^[-*]\s+/.test(trimmed)) {
      out.push('- ' + stripInline(trimmed.replace(/^[-*]\s+/, '')))
    } else if (/^---+$/.test(trimmed)) {
      // Decorative horizontal rule — drop it (becomes a blank line).
      out.push('')
    } else {
      out.push(stripInline(trimmed))
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * One combined plain-text document for all completed pages, mirroring the styled
 * .docx page order (title, url, body per page) but with zero formatting.
 */
export function buildPlainText(pages: GeneratedPage[], firmName: string): string {
  const completed = completedPagesOf(pages)
  const blocks = completed.map(page =>
    [page.page_title, page.page_url, '', markdownToPlainText(page.content_markdown ?? '')].join('\n')
  )
  return [
    `${firmName} — Website Content (plain text)`,
    '',
    blocks.join(`\n\n${DIVIDER}\n\n`),
    '',
  ].join('\n')
}

/**
 * One combined Word document using only the default Normal style (default font,
 * no heading styles, colors, tables, or cover). Content is the same styling-free
 * text as buildPlainText so it pastes cleanly out of Word too.
 */
export async function buildPlainDocx(pages: GeneratedPage[], firmName: string): Promise<Buffer> {
  const completed = completedPagesOf(pages)
  const children: Paragraph[] = [
    new Paragraph({ children: [new TextRun(`${firmName} — Website Content`)] }),
    new Paragraph({}),
  ]

  for (let i = 0; i < completed.length; i++) {
    const page = completed[i]
    if (i > 0) {
      children.push(new Paragraph({}), new Paragraph({ children: [new TextRun(DIVIDER)] }), new Paragraph({}))
    }
    children.push(new Paragraph({ children: [new TextRun(page.page_title)] }))
    children.push(new Paragraph({ children: [new TextRun(page.page_url)] }))
    children.push(new Paragraph({}))
    for (const line of markdownToPlainText(page.content_markdown ?? '').split('\n')) {
      children.push(line ? new Paragraph({ children: [new TextRun(line)] }) : new Paragraph({}))
    }
  }

  const doc = new Document({ sections: [{ children }] })
  return Buffer.from(await Packer.toBuffer(doc))
}
