import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  TableOfContents,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from 'docx'
import type { Database } from '@/types/database'

type GeneratedPage = Database['public']['Tables']['generated_pages']['Row']

function markdownToDocxParagraphs(markdown: string): Paragraph[] {
  const paragraphs: Paragraph[] = []
  const lines = markdown.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('## ')) {
      paragraphs.push(new Paragraph({
        text: trimmed.replace(/^## /, ''),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
      }))
    } else if (trimmed.startsWith('# ')) {
      paragraphs.push(new Paragraph({
        text: trimmed.replace(/^# /, ''),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 360, after: 180 },
      }))
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      paragraphs.push(new Paragraph({
        children: [new TextRun(trimmed.replace(/^[-*] /, ''))],
        bullet: { level: 0 },
        spacing: { after: 60 },
      }))
    } else if (trimmed.startsWith('---')) {
      // Skip horizontal rules
    } else {
      // Strip inline markdown formatting
      const clean = trimmed
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

      paragraphs.push(new Paragraph({
        children: [new TextRun(clean)],
        spacing: { after: 120 },
      }))
    }
  }

  return paragraphs
}

export async function buildDocx(
  pages: GeneratedPage[],
  firmName: string
): Promise<Buffer> {
  const completedPages = pages.filter(p => p.generation_status === 'complete' && p.content_markdown)
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const sections: (Paragraph | Table | TableOfContents)[] = []

  // Cover page
  sections.push(
    new Paragraph({ spacing: { before: 2400 } }),
    new Paragraph({
      children: [new TextRun({ text: firmName, bold: true, size: 56 })],
      spacing: { after: 240 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Website Content Package', size: 32 })],
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Prepared by CountingFive — ${today}`, size: 24, color: '666666' })],
      spacing: { after: 480 },
    }),
    new Paragraph({
      children: [new TextRun({ text: '', break: 1 })],
      pageBreakBefore: true,
    }),
  )

  // Table of contents
  sections.push(
    new Paragraph({ text: 'Table of Contents', heading: HeadingLevel.HEADING_1, spacing: { after: 240 } }),
    new TableOfContents('Table of Contents', {
      hyperlink: true,
      headingStyleRange: '1-2',
    }),
    new Paragraph({ children: [new TextRun({ text: '', break: 1 })], pageBreakBefore: true }),
  )

  // Page content
  for (const page of completedPages) {
    const contentParagraphs = markdownToDocxParagraphs(page.content_markdown ?? '')
    sections.push(
      new Paragraph({
        text: page.page_title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 360, after: 120 },
        pageBreakBefore: true,
      }),
      new Paragraph({
        children: [new TextRun({ text: page.page_url, italics: true, color: '888888', size: 20 })],
        spacing: { after: 240 },
      }),
      ...contentParagraphs,
    )
  }

  // Metadata appendix
  sections.push(
    new Paragraph({
      text: 'Metadata Appendix',
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      spacing: { after: 240 },
    }),
  )

  const headerRow = new TableRow({
    tableHeader: true,
    children: ['Page', 'Meta Title', 'Meta Description', 'Keyword', 'URL Slug'].map(text =>
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18 })] })],
        width: { size: 20, type: WidthType.PERCENTAGE },
      })
    ),
  })

  const dataRows = completedPages.map(page =>
    new TableRow({
      children: [
        page.page_title,
        page.meta_title ?? '',
        (page.meta_description ?? '').slice(0, 80),
        page.target_keyword ?? '',
        page.url_slug ?? page.page_url,
      ].map(text =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text, size: 16 })] })],
          width: { size: 20, type: WidthType.PERCENTAGE },
        })
      ),
    })
  )

  sections.push(
    new Table({
      rows: [headerRow, ...dataRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
        left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
        right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      },
    })
  )

  const doc = new Document({
    features: { updateFields: true },
    sections: [{ children: sections }],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}
