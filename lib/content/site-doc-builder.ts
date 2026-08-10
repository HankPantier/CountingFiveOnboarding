import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Bookmark,
  InternalHyperlink,
  PageBreak,
  Footer,
  PageNumber,
  AlignmentType,
} from 'docx'
import type { NavJson, NavItem } from '@/types/nav-json'
import { markdownToDocxParagraphs } from './markdown-to-docx'

// A single content page (or blog post) resolved from the live draft branch and
// ready to render. The route parses each file's frontmatter into this shape; the
// builder stays pure (no GitHub/DB access) so it's easy to test.
export type SiteDocInternalLink = { url: string; anchorText: string; reason?: string }
export type SiteDocFaq = { question: string; answer: string }

export type SiteDocPage = {
  path: string          // repo path, e.g. content/pages/services--cfo.md
  url: string           // site-relative url from frontmatter (or derived)
  title: string
  isPost: boolean
  body: string          // markdown body (frontmatter stripped)
  metaTitle: string
  metaDescription: string
  targetKeyword: string
  canonicalUrl: string
  schemaMarkup: string
  secondaryKeywords: string[]
  answerBlock: string
  eeatSignals: string[]
  internalLinks: SiteDocInternalLink[]
  faqBlock: SiteDocFaq[]
}

export type SiteDocInput = {
  firmName: string
  websiteUrl: string
  pages: SiteDocPage[]
  nav: NavJson | null
  // Passed in rather than read from Date so the caller controls the stamp
  // (keeps the builder deterministic/testable).
  generatedOn: string
}

const INK = '231F20'
const MUTED = '888888'

// Anchor ids must match between InternalHyperlink.anchor and Bookmark.id. The
// repo path is unique per page and stable, so it makes a safe anchor once its
// slashes/dots are replaced with a bookmark-safe separator.
function anchorFor(page: SiteDocPage): string {
  return `page-${page.path.replace(/[^a-zA-Z0-9]/g, '-')}`
}

function heading(text: string, opts: { pageBreakBefore?: boolean } = {}): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: opts.pageBreakBefore,
    spacing: { after: 240 },
  })
}

// Render the nav hierarchy (primary items + up to two child levels) as an
// indented "label · url" list — the site structure / sitemap section.
function navParagraphs(nav: NavJson): Paragraph[] {
  const out: Paragraph[] = []
  const walk = (items: NavItem[], depth: number) => {
    for (const item of items) {
      out.push(new Paragraph({
        indent: { left: depth * 360 },
        spacing: { after: 60 },
        children: [
          new TextRun({ text: item.label, bold: depth === 0, color: INK }),
          new TextRun({ text: `  ·  ${item.url}`, color: MUTED, italics: true }),
        ],
      }))
      if (item.children?.length) walk(item.children, depth + 1)
    }
  }
  walk(nav.primary, 0)
  if (nav.cta) {
    out.push(new Paragraph({
      spacing: { before: 120 },
      children: [
        new TextRun({ text: 'Header CTA: ', bold: true, color: INK }),
        new TextRun({ text: `${nav.cta.label}  ·  ${nav.cta.url}`, color: MUTED, italics: true }),
      ],
    }))
  }
  return out
}

// One labeled "Field: value" line for the SEO appendix, skipped when empty.
function fieldLine(label: string, value: string): Paragraph | null {
  if (!value.trim()) return null
  return new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 18, color: INK }),
      new TextRun({ text: value, size: 18 }),
    ],
  })
}

function seoBlock(page: SiteDocPage): Paragraph[] {
  const out: Paragraph[] = []
  out.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: page.title, bold: true, size: 22, color: INK })],
  }))
  out.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: page.url, italics: true, color: MUTED, size: 18 })],
  }))

  const lines = [
    fieldLine('Meta title', page.metaTitle),
    fieldLine('Meta description', page.metaDescription),
    fieldLine('Target keyword', page.targetKeyword),
    fieldLine('Secondary keywords', page.secondaryKeywords.join(', ')),
    fieldLine('Canonical URL', page.canonicalUrl),
    fieldLine('Schema type', page.schemaMarkup),
    fieldLine('Answer block', page.answerBlock),
    fieldLine('E-E-A-T signals', page.eeatSignals.join('; ')),
  ].filter((p): p is Paragraph => p !== null)
  out.push(...lines)

  if (page.internalLinks.length) {
    out.push(new Paragraph({
      spacing: { before: 60, after: 40 },
      children: [new TextRun({ text: 'Internal links', bold: true, size: 18, color: INK })],
    }))
    for (const link of page.internalLinks) {
      const reason = link.reason ? `  — ${link.reason}` : ''
      out.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 40 },
        children: [new TextRun({ text: `${link.anchorText} → ${link.url}${reason}`, size: 18 })],
      }))
    }
  }

  if (page.faqBlock.length) {
    out.push(new Paragraph({
      spacing: { before: 60, after: 40 },
      children: [new TextRun({ text: 'FAQ', bold: true, size: 18, color: INK })],
    }))
    for (const faq of page.faqBlock) {
      out.push(new Paragraph({
        spacing: { after: 20 },
        children: [new TextRun({ text: faq.question, bold: true, size: 18 })],
      }))
      out.push(new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: faq.answer, size: 18 })],
      }))
    }
  }

  return out
}

export async function buildSiteDocx(input: SiteDocInput): Promise<Buffer> {
  const { firmName, pages, nav, generatedOn } = input
  const sections: Paragraph[] = []

  // ── Cover ───────────────────────────────────────────────────────────────
  sections.push(
    new Paragraph({ spacing: { before: 2400 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: firmName, bold: true, size: 56, color: INK })],
      spacing: { after: 240 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Website Content & SEO Document', size: 32 })],
      spacing: { after: 120 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Prepared by Revaltus — ${generatedOn}`, size: 24, color: '666666' })],
      spacing: { after: 480 },
    }),
    new Paragraph({ children: [new PageBreak()] }),
  )

  // ── Site Structure (nav / sitemap) ──────────────────────────────────────
  if (nav && nav.primary.length) {
    sections.push(heading('Site Structure'))
    sections.push(...navParagraphs(nav))
    sections.push(new Paragraph({ children: [new PageBreak()] }))
  }

  // ── Table of Contents (manual, hyperlinked, no Word field codes) ────────
  sections.push(heading('Table of Contents'))
  for (const page of pages) {
    sections.push(new Paragraph({
      spacing: { after: 80 },
      children: [
        new InternalHyperlink({
          anchor: anchorFor(page),
          children: [
            new TextRun({ text: page.title, color: INK, underline: {} }),
            new TextRun({ text: `  ·  ${page.url}`, color: MUTED, italics: true }),
          ],
        }),
      ],
    }))
  }
  sections.push(new Paragraph({ children: [new PageBreak()] }))

  // ── Page content ────────────────────────────────────────────────────────
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    sections.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: i > 0,
      spacing: { before: 240, after: 120 },
      children: [
        new Bookmark({
          id: anchorFor(page),
          children: [new TextRun({ text: page.title, bold: true, size: 36, color: INK })],
        }),
      ],
    }))
    sections.push(new Paragraph({
      children: [new TextRun({ text: page.url, italics: true, color: MUTED, size: 20 })],
      spacing: { after: 240 },
    }))
    sections.push(...markdownToDocxParagraphs(page.body))
  }

  // ── SEO appendix ─────────────────────────────────────────────────────────
  sections.push(heading('SEO Appendix', { pageBreakBefore: true }))
  for (const page of pages) {
    sections.push(...seoBlock(page))
  }

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: ['Page ', PageNumber.CURRENT], size: 18, color: MUTED })],
      }),
    ],
  })

  const doc = new Document({
    sections: [{ children: sections, footers: { default: footer } }],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}
