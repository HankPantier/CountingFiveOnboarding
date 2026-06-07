import { DRAFT_BRANCH, listTree, readFile } from '@/lib/github/repo-files'
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

const MAX_TARGETS = 40
const ABOUT_MAX_CHARS = 120
const FRONTMATTER_FETCH_CAP = 50
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
  url: string
  slug: string
  isPost: boolean
  fallbackTitle: string
}

// Build the internal-link target list from the repo tree: site pages
// (content/pages/) plus existing posts (content/posts/), enriched with each
// file's target_keyword and meta_description/excerpt. Posts are prioritized
// for the (capped) frontmatter reads; any read/parse failure degrades that
// entry to title+url. Never throws. postSlugs is always the complete post
// list regardless of caps — callers use it for slug collision checks.
export async function buildInternalLinkTargets(githubRepo: string): Promise<{
  targets: InternalLinkTarget[]
  postSlugs: string[]
}> {
  const raw: RawTarget[] = []
  const postSlugs: string[] = []
  try {
    const entries = await listTree(githubRepo, DRAFT_BRANCH, 'content/')
    for (const e of entries) {
      if (e.type !== 'blob' || !e.path.endsWith('.md')) continue
      if (e.path.startsWith('content/pages/')) {
        const slug = e.path.slice('content/pages/'.length, -3)
        const url = slug === 'home' ? '/' : `/${slug.replace(/--/g, '/')}`
        raw.push({
          path: e.path,
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
          url: `/resources/${slug}`,
          slug,
          isPost: true,
          fallbackTitle: titleFromSlug(slug),
        })
      }
    }
  } catch (err) {
    console.warn('[internal-links] Failed to list repo tree:', err)
    return { targets: [], postSlugs: [] }
  }

  // Posts first: they're the higher-value link surface and the most likely to
  // be cut by the caps below.
  raw.sort((a, b) => Number(b.isPost) - Number(a.isPost))

  const targets: InternalLinkTarget[] = []
  const toEnrich = raw.slice(0, FRONTMATTER_FETCH_CAP)
  for (let i = 0; i < toEnrich.length; i += READ_CONCURRENCY) {
    const batch = toEnrich.slice(i, i + READ_CONCURRENCY)
    const enriched = await Promise.all(
      batch.map(async (t): Promise<InternalLinkTarget> => {
        try {
          const blob = await readFile(githubRepo, t.path, DRAFT_BRANCH)
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
          return {
            url: t.url,
            title: t.fallbackTitle,
            keyword: null,
            about: null,
            isPost: t.isPost,
            slug: t.slug,
          }
        }
      })
    )
    targets.push(...enriched)
  }
  for (const t of raw.slice(FRONTMATTER_FETCH_CAP)) {
    targets.push({
      url: t.url,
      title: t.fallbackTitle,
      keyword: null,
      about: null,
      isPost: t.isPost,
      slug: t.slug,
    })
  }

  return { targets: targets.slice(0, MAX_TARGETS), postSlugs }
}
