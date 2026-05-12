import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  Bookmark,
  InternalHyperlink,
  PageBreak,
  Footer,
  PageNumber,
  AlignmentType,
} from 'docx'
import type { Database } from '@/types/database'

type GeneratedPage = Database['public']['Tables']['generated_pages']['Row']

function anchorFor(page: Pick<GeneratedPage, 'id'>): string {
  // Bookmark ids must match between InternalHyperlink.anchor and Bookmark.id.
  return `page-${page.id}`
}

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
      // The page title gets emitted as a Bookmark-wrapped Heading 1 outside
      // this function, so an in-content H1 (the Claude-generated SEO title)
      // becomes Heading 2 to keep TOC structure tidy.
      paragraphs.push(new Paragraph({
        text: trimmed.replace(/^# /, ''),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
      }))
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      paragraphs.push(new Paragraph({
        children: [new TextRun(trimmed.replace(/^[-*] /, ''))],
        bullet: { level: 0 },
        spacing: { after: 60 },
      }))
    } else if (trimmed.startsWith('---')) {
      // Horizontal rules are decorative in markdown; treat as visual spacer.
      paragraphs.push(new Paragraph({ spacing: { after: 120 } }))
    } else {
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

  const sections: (Paragraph | Table)[] = []

  // ── Cover ───────────────────────────────────────────────────────────────
  sections.push(
    new Paragraph({ spacing: { before: 2400 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: firmName, bold: true, size: 56 })],
      spacing: { after: 240 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Website Content Package', size: 32 })],
      spacing: { after: 120 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Prepared by CountingFive — ${today}`, size: 24, color: '666666' })],
      spacing: { after: 480 },
    }),
    new Paragraph({ children: [new PageBreak()] }),
  )

  // ── Table of Contents (manual, hyperlinked, no Word field codes) ────────
  sections.push(
    new Paragraph({
      text: 'Table of Contents',
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 240 },
    }),
  )
  for (const page of completedPages) {
    sections.push(new Paragraph({
      spacing: { after: 80 },
      children: [
        new InternalHyperlink({
          anchor: anchorFor(page),
          children: [
            new TextRun({ text: page.page_title, color: '003B71', underline: {} }),
            new TextRun({ text: `  ·  ${page.page_url}`, color: '888888', italics: true }),
          ],
        }),
      ],
    }))
  }
  sections.push(new Paragraph({ children: [new PageBreak()] }))

  // ── Page content ────────────────────────────────────────────────────────
  for (let i = 0; i < completedPages.length; i++) {
    const page = completedPages[i]
    const contentParagraphs = markdownToDocxParagraphs(page.content_markdown ?? '')

    // Page title is the anchor target for TOC links. Wrapping in a Bookmark
    // means the link lands exactly on the title rather than the top of the
    // page (useful when content gets long).
    sections.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: i > 0,
      spacing: { before: 240, after: 120 },
      children: [
        new Bookmark({
          id: anchorFor(page),
          children: [new TextRun({ text: page.page_title, bold: true, size: 36 })],
        }),
      ],
    }))
    sections.push(new Paragraph({
      children: [new TextRun({ text: page.page_url, italics: true, color: '888888', size: 20 })],
      spacing: { after: 240 },
    }))
    sections.push(...contentParagraphs)
  }

  // ── Metadata appendix ───────────────────────────────────────────────────
  sections.push(new Paragraph({
    text: 'Metadata Appendix',
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    spacing: { after: 240 },
  }))

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

  sections.push(new Table({
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
  }))

  // Footer: page number on every page, centered. Renders consistently in
  // Word, Pages, Google Docs, and inline-PDF viewers.
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ children: ['Page ', PageNumber.CURRENT], size: 18, color: '888888' }),
        ],
      }),
    ],
  })

  const doc = new Document({
    sections: [{ children: sections, footers: { default: footer } }],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}
