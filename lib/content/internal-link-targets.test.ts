import { describe, it, expect, vi, beforeEach } from 'vitest'

// Distinct draft vs main trees so we can prove the cross-link index is a UNION
// (published + WIP), deduped by url with draft preferred.
const entry = (path: string) => ({ path, sha: 'x', type: 'blob' as const, size: 1 })
const DRAFT_TREE = [
  entry('content/pages/home.md'),
  entry('content/pages/services.md'),
  entry('content/posts/draft-only-post.md'),
  entry('content/posts/shared-post.md'),
  entry('content/pages/_ignore.txt'),
]
const MAIN_TREE = [
  entry('content/pages/services.md'),
  entry('content/posts/shared-post.md'),
  entry('content/posts/published-only-post.md'),
]

const defaultListTree = async (_slug: string, branch: string, _prefix?: string) =>
  branch === 'main' ? MAIN_TREE : DRAFT_TREE

vi.mock('@/lib/github/repo-files', () => ({
  DRAFT_BRANCH: 'draft',
  MAIN_BRANCH: 'main',
  listTree: vi.fn(),
  readFile: vi.fn(async (_slug: string, path: string, branch: string) => ({
    content: `---\ntitle: ${branch}:${path}\ntarget_keyword: kw\nmeta_description: About ${path}\n---\nBody.`,
  })),
}))

import { buildCrossLinkIndex, buildInternalLinkTargets } from './internal-link-targets'
import { listTree } from '@/lib/github/repo-files'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listTree).mockImplementation(defaultListTree)
})

describe('buildCrossLinkIndex', () => {
  it('unions draft + main, deduped by url with draft winning', async () => {
    const { targets } = await buildCrossLinkIndex('acme')
    const urls = targets.map((t) => t.url)
    // shared-post appears once, not twice
    expect(urls.filter((u) => u === '/resources/shared-post')).toHaveLength(1)
    // a main-ONLY post survives (proves published content is fed in)
    expect(urls).toContain('/resources/published-only-post')
    // a draft-only post survives too
    expect(urls).toContain('/resources/draft-only-post')
    // the shared page is present once
    expect(urls.filter((u) => u === '/services')).toHaveLength(1)
    // home maps to '/'
    expect(urls).toContain('/')

    // draft preferred on collision: shared-post enriched from the draft file
    const shared = targets.find((t) => t.url === '/resources/shared-post')
    expect(shared?.title).toBe('draft:content/posts/shared-post.md')
  })

  it('orders posts before pages', async () => {
    const { targets } = await buildCrossLinkIndex('acme')
    const firstPageIdx = targets.findIndex((t) => !t.isPost)
    const lastPostIdx = targets.map((t) => t.isPost).lastIndexOf(true)
    expect(lastPostIdx).toBeLessThan(firstPageIdx)
  })

  it('reports union postSlugs and main-only publishedPostSlugs', async () => {
    const { postSlugs, publishedPostSlugs } = await buildCrossLinkIndex('acme')
    expect(new Set(postSlugs)).toEqual(
      new Set(['draft-only-post', 'shared-post', 'published-only-post'])
    )
    expect(new Set(publishedPostSlugs)).toEqual(new Set(['shared-post', 'published-only-post']))
  })

  it('never throws when the main branch has no content', async () => {
    vi.mocked(listTree).mockImplementation(async (_s: string, branch: string) => {
      if (branch === 'main') throw new Error('no main branch yet')
      return DRAFT_TREE
    })
    const { targets, publishedPostSlugs } = await buildCrossLinkIndex('fresh')
    expect(publishedPostSlugs).toEqual([])
    expect(targets.map((t) => t.url)).toContain('/resources/draft-only-post')
  })
})

describe('buildInternalLinkTargets', () => {
  it('defaults to the draft branch and returns the full post list (no 40-cap)', async () => {
    const { targets, postSlugs } = await buildInternalLinkTargets('acme')
    expect(targets.length).toBeGreaterThanOrEqual(4)
    expect(new Set(postSlugs)).toEqual(new Set(['draft-only-post', 'shared-post']))
  })

  it('reads the requested branch when asked', async () => {
    const { postSlugs } = await buildInternalLinkTargets('acme', { branch: 'main' })
    expect(new Set(postSlugs)).toEqual(new Set(['shared-post', 'published-only-post']))
  })
})
