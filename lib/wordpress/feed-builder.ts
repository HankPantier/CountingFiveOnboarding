// ---------------------------------------------------------------------------
// Build the per-site JSON feed of published blog/resource posts for the
// WordPress blog-sync bridge (see ./README.md).
//
// Source of truth is the client's git repo `main` branch (published content).
// We reuse the existing frontmatter parser and the Divi bridge's markdown→HTML
// converter (which already sanitizes URL schemes and strips machine-only
// annotation lines) so this stays self-contained and deletable in one move.
// ---------------------------------------------------------------------------

import { splitFile, type Frontmatter } from '@/lib/editor/frontmatter'
import { markdownToHtml } from '@/lib/content/divi/markdown'
import { listTree, readFile, MAIN_BRANCH } from '@/lib/github/repo-files'
import { assetUrlFor, type HeroImage } from './assets'

export type WpFeedPost = {
  slug: string // WordPress match key
  title: string
  html: string
  excerpt: string
  date_gmt: string // "YYYY-MM-DD HH:MM:SS" (GMT), or '' when absent
  tags: string[]
  author: string | null
  content_type: string
  canonical_url: string
  meta_title: string
  meta_description: string
  hero_image: HeroImage | null
  inline_images: HeroImage[] // reserved; empty for current generator output
}

const POSTS_PREFIX = 'content/posts/'
const READ_CONCURRENCY = 4
// buildPostMarkdown appends an inline "## SEO & AIO Metadata" block to the body;
// it carries no block annotation, so strip from the marker to end of file before
// converting to HTML (mirrors lib/content/divi/from-frontmatter.ts).
const SEO_SECTION_MARKER = '## SEO & AIO Metadata'

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

function stripInlineSeoSection(body: string): string {
  const idx = body.indexOf(SEO_SECTION_MARKER)
  if (idx === -1) return body
  return body.slice(0, idx).replace(/\n*-{3,}\s*\n*$/, '\n').trimEnd() + '\n'
}

// The generator writes `tags: ["a", "b"]` JSON-quoted, which the frontmatter
// parser refuses to treat as an inline array (it bails on quotes) — so tags land
// in `fields` as a raw string, not `arrayFields`. Handle both: arrayFields for
// legacy unquoted posts, JSON.parse for the current quoted form.
function parseTags(fm: Frontmatter | null): string[] {
  if (!fm) return []
  const arr = fm.arrayFields['tags']
  if (arr) return arr
  const raw = fm.fields['tags']
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map((t) => String(t).trim()).filter(Boolean)
  } catch {
    /* fall through to a bare comma split */
  }
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => unquote(s.trim()))
    .filter(Boolean)
}

// Generator writes `date: YYYY-MM-DD`. WordPress wants `post_date_gmt` as
// "YYYY-MM-DD HH:MM:SS". Treat a date-only value as midnight GMT. Best-effort
// parse anything else; leave unrecognized values for the plugin to default.
function normalizeDate(raw: string): string {
  const t = unquote(raw).trim()
  if (t === '') return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t} 00:00:00`
  const d = new Date(t)
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
  }
  return t
}

// content/posts/<slug>.md → <slug>
function slugFromPath(path: string): string {
  return path.replace(POSTS_PREFIX, '').replace(/\.md$/, '')
}

function heroImage(fm: Frontmatter | null, siteKey: string, origin: string): HeroImage | null {
  const image = scalar(fm, 'image')
  if (!image) return null
  const alt = scalar(fm, 'image_alt') || null
  // An absolute URL (e.g. a Pexels CDN link) is publicly fetchable — pass it
  // through verbatim. A bare filename is a private repo asset → proxy URL.
  if (/^https?:\/\//i.test(image)) {
    return { url: image, requires_auth: false, alt, filename: image.split('/').pop() ?? image }
  }
  return { url: assetUrlFor(origin, siteKey, image), requires_auth: true, alt, filename: image }
}

// Map one repo post file to the feed shape. Pure (no network) — unit-tested.
// Returns null for a post explicitly flagged draft/unpublished in frontmatter
// (defensive; the publish flow should already keep drafts off `main`).
export function postFromRepoFile(
  path: string,
  content: string,
  opts: { siteKey: string; origin: string }
): WpFeedPost | null {
  const { frontmatter, body } = splitFile(content)
  if (scalar(frontmatter, 'draft').toLowerCase() === 'true') return null
  if (scalar(frontmatter, 'status').toLowerCase() === 'draft') return null

  const slug = scalar(frontmatter, 'slug') || slugFromPath(path)
  return {
    slug,
    title: scalar(frontmatter, 'title') || slug,
    html: markdownToHtml(stripInlineSeoSection(body)),
    excerpt: scalar(frontmatter, 'excerpt'),
    date_gmt: normalizeDate(frontmatter?.fields['date'] ?? ''),
    tags: parseTags(frontmatter),
    author: scalar(frontmatter, 'author') || null,
    content_type: scalar(frontmatter, 'content_type') || 'blog',
    canonical_url: scalar(frontmatter, 'canonical_url') || `/resources/${slug}`,
    meta_title: scalar(frontmatter, 'meta_title'),
    meta_description: scalar(frontmatter, 'meta_description'),
    hero_image: heroImage(frontmatter, opts.siteKey, opts.origin),
    inline_images: [],
  }
}

// List and read every published post from `main`, batched to stay under
// GitHub's secondary rate limit (mirrors the export-divi reader).
export async function buildFeed(
  githubRepo: string,
  siteKey: string,
  origin: string
): Promise<WpFeedPost[]> {
  const tree = await listTree(githubRepo, MAIN_BRANCH, POSTS_PREFIX)
  const paths = tree
    .filter((e) => e.type === 'blob' && e.path.startsWith(POSTS_PREFIX) && e.path.endsWith('.md'))
    .map((e) => e.path)

  const posts: WpFeedPost[] = []
  for (let i = 0; i < paths.length; i += READ_CONCURRENCY) {
    const batch = paths.slice(i, i + READ_CONCURRENCY)
    const read = await Promise.all(
      batch.map(async (path) => ({ path, content: (await readFile(githubRepo, path, MAIN_BRANCH)).content }))
    )
    for (const f of read) {
      const post = postFromRepoFile(f.path, f.content, { siteKey, origin })
      if (post) posts.push(post)
    }
  }
  return posts
}
