import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { createServerClient } from '@/lib/supabase/server'
import {
  DRAFT_BRANCH,
  ensureDraftBranch,
  listTree,
  readFile,
} from '@/lib/github/repo-files'
import { splitFile, type Frontmatter } from '@/lib/editor/frontmatter'
import { parseNavJson } from '@/lib/editor/nav-config'
import {
  buildSiteDocx,
  type SiteDocPage,
  type SiteDocInternalLink,
  type SiteDocFaq,
} from '@/lib/content/site-doc-builder'
import type { SessionSchema } from '@/types/session-schema'
import type { NavJson } from '@/types/nav-json'

export const runtime = 'nodejs'
export const maxDuration = 60

const NAV_PATH = 'content/nav.json'
// Bound concurrent GitHub reads so a large site (dozens of pages) neither
// serializes slowly nor bursts past GitHub's secondary rate limit. Mirrors
// PUSH_BLOB_CONCURRENCY in repo-files.ts.
const READ_CONCURRENCY = 4

// Unwrap a frontmatter scalar. Values are written as JSON-quoted strings
// (title: "Foo | Bar") or bare tokens; JSON.parse handles proper unescaping,
// with a plain quote-strip fallback.
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

// Bare inline arrays (secondary_keywords) live in arrayFields; JSON string
// arrays (eeat_signals when quoted) stay in fields and are parsed here.
function stringArray(fm: Frontmatter | null, key: string): string[] {
  if (fm?.arrayFields[key]) return fm.arrayFields[key]
  const raw = fm?.fields[key]
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter((v) => v.length > 0)
  } catch {
    /* not JSON — treat as absent */
  }
  return []
}

function internalLinks(fm: Frontmatter | null): SiteDocInternalLink[] {
  const raw = fm?.fields['internal_links']
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((l: Record<string, unknown>) => ({
        url: String(l.url ?? ''),
        anchorText: String(l.anchor_text ?? l.anchorText ?? ''),
        reason: l.reason ? String(l.reason) : undefined,
      }))
      .filter((l) => l.url || l.anchorText)
  } catch {
    return []
  }
}

function faqBlock(fm: Frontmatter | null): SiteDocFaq[] {
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

// content/pages/services--cfo.md → /services/cfo ; home → /
function deriveUrl(path: string): string {
  const slug = path.replace(/^content\/(pages|posts|drafts)\//, '').replace(/\.md$/, '')
  if (slug === 'home' || slug === 'index') return '/'
  return '/' + slug.split('--').join('/')
}

function titleFromPath(path: string): string {
  const slug = path.replace(/^content\/(pages|posts|drafts)\//, '').replace(/\.md$/, '')
  const last = slug.split('--').pop() ?? slug
  return last.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Page titles arrive as "Page Name | Firm Name" (sometimes with the firm name
// repeated). The firm name is already on the cover and reads as clutter in the
// TOC and headings, so keep just the leading page-name segment before the first
// pipe. The verbatim meta_title is still shown in the SEO appendix.
function cleanTitle(raw: string): string {
  const first = raw.split('|')[0].trim()
  return first || raw.trim()
}

// Page files (from deliverable-builder → buildPageMarkdown) append an inline
// "## SEO & AIO Metadata" block to the body — answer block, E-E-A-T, internal
// links, FAQ — which the document already presents in its dedicated SEO
// Appendix. Drop that block from the rendered page content to avoid printing it
// twice, but KEEP any trailing "## Structured Data" section (the JSON-LD schema
// code) so the schema still ships with the page.
const SEO_SECTION_MARKER = '## SEO & AIO Metadata'
const STRUCTURED_DATA_MARKER = '## Structured Data'

function stripInlineSeoSection(body: string): string {
  const seoIdx = body.indexOf(SEO_SECTION_MARKER)
  if (seoIdx === -1) return body
  // Cut the `---` rule that precedes the section along with it.
  const before = body.slice(0, seoIdx).replace(/\n*-{3,}\s*\n*$/, '\n').trimEnd()
  const structIdx = body.indexOf(STRUCTURED_DATA_MARKER, seoIdx)
  if (structIdx !== -1) return `${before}\n\n${body.slice(structIdx)}`
  return `${before}\n`
}

function toSiteDocPage(path: string, content: string, isPost: boolean): SiteDocPage {
  const { frontmatter, body } = splitFile(content)
  const url = scalar(frontmatter, 'url') || deriveUrl(path)
  const title = cleanTitle(scalar(frontmatter, 'title') || titleFromPath(path))
  return {
    path,
    url,
    title,
    isPost,
    body: stripInlineSeoSection(body),
    metaTitle: scalar(frontmatter, 'meta_title'),
    metaDescription: scalar(frontmatter, 'meta_description'),
    targetKeyword: scalar(frontmatter, 'target_keyword'),
    canonicalUrl: scalar(frontmatter, 'canonical_url'),
    schemaMarkup: scalar(frontmatter, 'schema_markup'),
    secondaryKeywords: stringArray(frontmatter, 'secondary_keywords'),
    answerBlock: scalar(frontmatter, 'answer_block'),
    eeatSignals: stringArray(frontmatter, 'eeat_signals'),
    internalLinks: internalLinks(frontmatter),
    faqBlock: faqBlock(frontmatter),
  }
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withSlash === '' ? '/' : withSlash.toLowerCase()
}

// Flatten nav urls in reading order so pages sort the way they appear in the
// site nav; pages absent from nav keep their tree order after the nav'd ones.
function flattenNavUrls(nav: NavJson | null): string[] {
  if (!nav) return []
  const urls: string[] = []
  const walk = (items: NavJson['primary']) => {
    for (const item of items) {
      urls.push(normalizeUrl(item.url))
      if (item.children?.length) walk(item.children)
    }
  }
  walk(nav.primary)
  return urls
}

function orderPages(pages: SiteDocPage[], nav: NavJson | null): SiteDocPage[] {
  const navOrder = flattenNavUrls(nav)
  const rank = (p: SiteDocPage): number => {
    const idx = navOrder.indexOf(normalizeUrl(p.url))
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx
  }
  const site = pages.filter((p) => !p.isPost).sort((a, b) => rank(a) - rank(b) || a.url.localeCompare(b.url))
  const posts = pages.filter((p) => p.isPost).sort((a, b) => a.url.localeCompare(b.url))
  return [...site, ...posts]
}

async function readInBatches(
  repo: string,
  paths: string[]
): Promise<{ path: string; content: string }[]> {
  const out: { path: string; content: string }[] = []
  for (let i = 0; i < paths.length; i += READ_CONCURRENCY) {
    const batch = paths.slice(i, i + READ_CONCURRENCY)
    const read = await Promise.all(
      batch.map(async (path) => ({ path, content: (await readFile(repo, path, DRAFT_BRANCH)).content }))
    )
    out.push(...read)
  }
  return out
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'site'
  )
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('website_url, schema_data')
    .eq('id', ctx.sessionId)
    .single()

  const schema = (session?.schema_data ?? null) as SessionSchema | null
  const firmName = schema?.business?.name?.trim() || session?.website_url || 'Untitled client'
  const websiteUrl = session?.website_url ?? ''

  try {
    await ensureDraftBranch(ctx.githubRepo)
    const tree = await listTree(ctx.githubRepo, DRAFT_BRANCH, 'content/')

    const pagePaths = tree
      .filter((e) => e.type === 'blob' && e.path.startsWith('content/pages/') && e.path.endsWith('.md'))
      .map((e) => e.path)
    const postPaths = tree
      .filter((e) => e.type === 'blob' && e.path.startsWith('content/posts/') && e.path.endsWith('.md'))
      .map((e) => e.path)

    const [pageFiles, postFiles] = await Promise.all([
      readInBatches(ctx.githubRepo, pagePaths),
      readInBatches(ctx.githubRepo, postPaths),
    ])

    const pages: SiteDocPage[] = [
      ...pageFiles.map((f) => toSiteDocPage(f.path, f.content, false)),
      ...postFiles.map((f) => toSiteDocPage(f.path, f.content, true)),
    ]

    let nav: NavJson | null = null
    if (tree.some((e) => e.path === NAV_PATH)) {
      try {
        const navBlob = await readFile(ctx.githubRepo, NAV_PATH, DRAFT_BRANCH)
        nav = parseNavJson(navBlob.content)
      } catch {
        // Malformed/absent nav is non-fatal — omit the site-structure section.
        nav = null
      }
    }

    if (pages.length === 0) {
      return NextResponse.json({ error: 'No content pages found for this site' }, { status: 404 })
    }

    const generatedOn = new Date().toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })

    const buffer = await buildSiteDocx({
      firmName,
      websiteUrl,
      pages: orderPages(pages, nav),
      nav,
      generatedOn,
    })

    const filename = `${slugify(firmName)}-site-content.docx`
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
