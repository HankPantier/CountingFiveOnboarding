// ---------------------------------------------------------------------------
// Map a live-repo page `.md` file (YAML frontmatter + block-annotated body) to
// the source-neutral DiviPageInput the exporter consumes. Part of the throwaway
// Divi export bridge (see ./README.md).
//
// This is the "live repo" source: the same content the in-editor "Download doc"
// reads (GitHub draft branch), so the export always matches what's live —
// including post-generation edits and pages the original generated_pages rows
// never had.
// ---------------------------------------------------------------------------

import { splitFile, type Frontmatter } from '@/lib/editor/frontmatter'
import type { DiviPageInput } from './page'

// Frontmatter scalars are written JSON-quoted (title: "Foo | Bar") or bare.
function unquote(raw: string): string {
  const t = raw.trim()
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      return String(JSON.parse(t))
    } catch {
      return t.slice(1, -1)
    }
  }
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1)
  return t
}

function scalar(fm: Frontmatter | null, key: string): string {
  const raw = fm?.fields[key]
  return raw === undefined ? '' : unquote(raw)
}

function faqBlock(fm: Frontmatter | null): Array<{ question: string; answer: string }> {
  const raw = fm?.fields['faq_block']
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((f: Record<string, unknown>) => ({
        question: String(f.question ?? ''),
        answer: String(f.answer ?? ''),
      }))
      .filter((f) => f.question || f.answer)
  } catch {
    return []
  }
}

// content/pages/services--cfo.md → /services/cfo ; home/index → /
export function deriveUrl(path: string): string {
  const slug = path.replace(/^content\/(pages|posts|drafts)\//, '').replace(/\.md$/, '')
  if (slug === 'home' || slug === 'index') return '/'
  return '/' + slug.split('--').join('/')
}

function titleFromPath(path: string): string {
  const slug = path.replace(/^content\/(pages|posts|drafts)\//, '').replace(/\.md$/, '')
  const last = slug.split('--').pop() ?? slug
  return last.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Titles arrive as "Page Name | Firm Name" — keep the leading page-name segment.
function cleanTitle(raw: string): string {
  const first = raw.split('|')[0].trim()
  return first || raw.trim()
}

// buildPageMarkdown appends an inline "## SEO & AIO Metadata" block (and maybe a
// trailing "## Structured Data" JSON-LD block) to the body. Neither carries a
// `<!-- block: -->` annotation, so parseDiviSections would otherwise sweep them
// into the final section's content. Strip from the SEO marker to end of file.
const SEO_SECTION_MARKER = '## SEO & AIO Metadata'

function stripInlineSeoSection(body: string): string {
  const idx = body.indexOf(SEO_SECTION_MARKER)
  if (idx === -1) return body
  return body.slice(0, idx).replace(/\n*-{3,}\s*\n*$/, '\n').trimEnd() + '\n'
}

export function pageInputFromRepoFile(path: string, content: string): DiviPageInput {
  const { frontmatter, body } = splitFile(content)
  return {
    page_title: cleanTitle(scalar(frontmatter, 'title') || titleFromPath(path)),
    page_url: scalar(frontmatter, 'url') || deriveUrl(path),
    hero_block: scalar(frontmatter, 'hero') || 'page-header',
    hero_variant: scalar(frontmatter, 'hero_variant') || null,
    hero_image_alt: scalar(frontmatter, 'hero_image_alt') || null,
    hero_subhead: scalar(frontmatter, 'hero_subhead') || null,
    // Hero stock query isn't persisted in repo frontmatter; body block `query:`
    // annotations still resolve. Home hero simply renders without a stock image.
    hero_image_query: null,
    content_markdown: stripInlineSeoSection(body),
    faq_block: faqBlock(frontmatter),
    cta: null,
  }
}
