import { DRAFT_BRANCH, MAIN_BRANCH, listTree, readFile } from '@/lib/github/repo-files'
import { splitFile } from '@/lib/editor/frontmatter'

// One internal-link candidate for the drafting prompt: URL plus enough
// frontmatter context (keyword + one-line description) for the model to make
// genuinely relevant link choices instead of guessing from filenames.
export type InternalLinkTarget = {
  url: string
  title: string
  keyword: string | null
  about: string | null
  isPost: boolean
  slug: string
}

// The top N (posts-first) get a frontmatter read for keyword + description; the
// long tail is emitted as title+url only, so a large site stays inside the
// drafting prompt's token budget without silently dropping linkable pages.
const DEFAULT_ENRICH_CAP = 60
// Pure runaway guard — a repo with thousands of files can't dump every URL into
// a prompt. Well above any real client site.
const DEFAULT_MAX_TARGETS = 400
const ABOUT_MAX_CHARS = 120
const READ_CONCURRENCY = 5

export function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, ABOUT_MAX_CHARS)
}

type RawTarget = {
  path: string
  branch: string
  url: string
  slug: string
  isPost: boolean
  fallbackTitle: string
}

// List the linkable markdown files on one branch as raw targets (site pages +
// existing posts), without reading any file bodies. Never throws — a missing
// branch (e.g. a fresh repo with no `main` content) degrades to empty.
async function collectRawTargets(
  githubRepo: string,
  branch: string
): Promise<{ raw: RawTarget[]; postSlugs: string[] }> {
  const raw: RawTarget[] = []
  const postSlugs: string[] = []
  try {
    const entries = await listTree(githubRepo, branch, 'content/')
    for (const e of entries) {
      if (e.type !== 'blob' || !e.path.endsWith('.md')) continue
      if (e.path.startsWith('content/pages/')) {
        const slug = e.path.slice('content/pages/'.length, -3)
        const url = slug === 'home' ? '/' : `/${slug.replace(/--/g, '/')}`
        raw.push({
          path: e.path,
          branch,
          url,
          slug,
          isPost: false,
          fallbackTitle: titleFromSlug(slug.split('--').pop() ?? slug),
        })
      } else if (e.path.startsWith('content/posts/')) {
        const slug = e.path.slice('content/posts/'.length, -3)
        postSlugs.push(slug)
        raw.push({
          path: e.path,
          branch,
          url: `/resources/${slug}`,
          slug,
          isPost: true,
          fallbackTitle: titleFromSlug(slug),
        })
      }
    }
  } catch (err) {
    console.warn(`[internal-links] Failed to list ${branch} tree:`, err)
    return { raw: [], postSlugs: [] }
  }
  return { raw, postSlugs }
}

// Two-tier enrichment: posts first, frontmatter read for the top `enrichCap`
// (keyword + meta/excerpt), title+url only for the rest, capped at `maxTargets`.
// Reads each file from the branch stamped on its raw target. Never throws — any
// read/parse failure degrades that entry to title+url.
async function enrichTargets(
  githubRepo: string,
  raw: RawTarget[],
  enrichCap: number,
  maxTargets: number
): Promise<InternalLinkTarget[]> {
  // Posts first: higher-value link surface and most likely to be cut by the caps.
  const sorted = raw.slice().sort((a, b) => Number(b.isPost) - Number(a.isPost)).slice(0, maxTargets)

  const targets: InternalLinkTarget[] = []
  const toEnrich = sorted.slice(0, enrichCap)
  for (let i = 0; i < toEnrich.length; i += READ_CONCURRENCY) {
    const batch = toEnrich.slice(i, i + READ_CONCURRENCY)
    const enriched = await Promise.all(
      batch.map(async (t): Promise<InternalLinkTarget> => {
        try {
          const blob = await readFile(githubRepo, t.path, t.branch)
          const { frontmatter } = splitFile(blob.content)
          const fields = frontmatter?.fields ?? {}
          const about = fields.meta_description || fields.excerpt || ''
          return {
            url: t.url,
            title: fields.title?.trim() || t.fallbackTitle,
            keyword: fields.target_keyword?.trim() || null,
            about: about ? oneLine(about) : null,
            isPost: t.isPost,
            slug: t.slug,
          }
        } catch (err) {
          console.warn(`[internal-links] Frontmatter read failed for ${t.path}:`, err)
          return { url: t.url, title: t.fallbackTitle, keyword: null, about: null, isPost: t.isPost, slug: t.slug }
        }
      })
    )
    targets.push(...enriched)
  }
  for (const t of sorted.slice(enrichCap)) {
    targets.push({ url: t.url, title: t.fallbackTitle, keyword: null, about: null, isPost: t.isPost, slug: t.slug })
  }
  return targets
}

// Build the internal-link target list from ONE branch's repo tree: site pages
// (content/pages/) plus existing posts (content/posts/), enriched with each
// file's target_keyword and meta_description/excerpt. Never throws. postSlugs is
// always the complete post list regardless of caps — callers use it for slug
// collision checks. Defaults to the draft branch (WIP truth for within-batch links).
export async function buildInternalLinkTargets(
  githubRepo: string,
  opts?: { branch?: string; enrichCap?: number; maxTargets?: number }
): Promise<{ targets: InternalLinkTarget[]; postSlugs: string[] }> {
  const branch = opts?.branch ?? DRAFT_BRANCH
  const enrichCap = opts?.enrichCap ?? DEFAULT_ENRICH_CAP
  const maxTargets = opts?.maxTargets ?? DEFAULT_MAX_TARGETS
  const { raw, postSlugs } = await collectRawTargets(githubRepo, branch)
  const targets = await enrichTargets(githubRepo, raw, enrichCap, maxTargets)
  return { targets, postSlugs }
}

// The per-client rolling cross-link index: the union of the draft branch (WIP,
// within-batch targets) AND the main branch (already-PUBLISHED pages/posts), so
// newly generated content reliably links back to the client's live corpus.
// Deduped by url with the draft entry preferred (draft is a superset of main in
// the normal flow). Never throws — a repo with no `main` content yet just yields
// the draft set.
//   postSlugs          — union of draft+main post slugs (filename collision set)
//   publishedPostSlugs — main-only post slugs (already live)
export async function buildCrossLinkIndex(githubRepo: string): Promise<{
  targets: InternalLinkTarget[]
  postSlugs: string[]
  publishedPostSlugs: string[]
}> {
  const [draft, main] = await Promise.all([
    collectRawTargets(githubRepo, DRAFT_BRANCH),
    collectRawTargets(githubRepo, MAIN_BRANCH),
  ])

  // Dedup raw by url before enriching (draft wins) so a page present on both
  // branches is read once, from draft.
  const byUrl = new Map<string, RawTarget>()
  for (const t of main.raw) byUrl.set(t.url, t)
  for (const t of draft.raw) byUrl.set(t.url, t)

  const targets = await enrichTargets(
    githubRepo,
    [...byUrl.values()],
    DEFAULT_ENRICH_CAP,
    DEFAULT_MAX_TARGETS
  )
  const postSlugs = [...new Set([...draft.postSlugs, ...main.postSlugs])]
  return { targets, postSlugs, publishedPostSlugs: main.postSlugs }
}
