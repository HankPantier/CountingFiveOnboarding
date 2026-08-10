import { Paragraph, HeadingLevel, TextRun } from 'docx'

// Convert the light markdown our page bodies use (## / # headings, - / * bullets,
// --- rules, **bold**/*italic*/[link](url) inline marks) into docx Paragraphs.
// Shared by the content-package builder (lib/content/docx-builder.ts) and the
// live-draft site document (lib/content/site-doc-builder.ts) so both render page
// bodies identically. Inline marks are stripped to plain text — the runs stay
// simple and predictable, matching the original single-purpose implementation.
export function markdownToDocxParagraphs(markdown: string): Paragraph[] {
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
