import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REDIRECTS_HEADER, formatClearedRedirectNotice, removeRedirectsFrom } from './redirects'

const h = vi.hoisted(() => ({
  redirects: null as string | null,
  writeFile: vi.fn(async (..._args: unknown[]) => ({ commitSha: 'c1', blobSha: 'page-blob-1' })),
  writeFiles: vi.fn(async (..._args: unknown[]) => ({
    commitSha: 'c2',
    blobs: { 'content/pages/about.md': 'page-blob-2', 'content/redirects.csv': 'r-blob' },
  })),
}))

vi.mock('@/lib/github/repo-files', () => {
  class FileNotFoundError extends Error {}
  return {
    DRAFT_BRANCH: 'draft',
    FileNotFoundError,
    readFile: vi.fn(async (_slug: string, path: string) => {
      if (h.redirects === null) throw new FileNotFoundError(path)
      return { path, content: h.redirects, sha: 'redirects-sha' }
    }),
    writeFile: h.writeFile,
    writeFiles: h.writeFiles,
  }
})

import { planRedirectClear, writeNewPage } from './new-page-redirects'

const H = REDIRECTS_HEADER

describe('removeRedirectsFrom', () => {
  it('drops rows whose source is the url and keeps everything else byte-for-byte', () => {
    const text = `# comment\n${H}/about,/,301,old\n/team,/about,301,keep\n/x,/y,301,keep\n`
    const { content, removed } = removeRedirectsFrom(text, '/about')
    expect(removed).toEqual([{ from: '/about', to: '/', status: '301', reason: 'old' }])
    expect(content).toBe(`# comment\n${H}/team,/about,301,keep\n/x,/y,301,keep\n`)
  })
  it('matches case-insensitively and ignores a trailing slash', () => {
    const { removed } = removeRedirectsFrom(`${H}/About/,/,301,x\n`, '/about')
    expect(removed).toHaveLength(1)
  })
  it('never removes pattern sources', () => {
    const text = `${H}/services/:slug,/,301,x\n`
    expect(removeRedirectsFrom(text, '/services/:slug').removed).toHaveLength(0)
  })
  it('returns the input unchanged when nothing matches', () => {
    const text = `${H}/a,/b,301,x\n`
    expect(removeRedirectsFrom(text, '/c')).toEqual({ content: text, removed: [] })
  })
  it('formats a notice only when something was removed', () => {
    expect(formatClearedRedirectNotice([])).toBeNull()
    expect(formatClearedRedirectNotice([{ from: '/a', to: '/b', status: '301', reason: '' }])).toMatch(/\/a → \/b/)
  })
})

describe('writeNewPage', () => {
  beforeEach(() => {
    h.writeFile.mockClear()
    h.writeFiles.mockClear()
  })

  it('writes the page and the cleaned redirects.csv in ONE commit when a row shadows the url', async () => {
    h.redirects = `${H}/about,/who-we-are,301,moved\n/x,/y,301,keep\n`
    const out = await writeNewPage('repo', 'content/pages/about.md', '/about', 'body', 'Create page /about', {})
    expect(h.writeFile).not.toHaveBeenCalled()
    expect(h.writeFiles).toHaveBeenCalledTimes(1)
    const files = h.writeFiles.mock.calls[0]![1] as { path: string; content: string; expectedSha: string | null }[]
    expect(files).toEqual([
      { path: 'content/pages/about.md', content: 'body', expectedSha: null },
      { path: 'content/redirects.csv', content: `${H}/x,/y,301,keep\n`, expectedSha: 'redirects-sha' },
    ])
    expect(out.blobSha).toBe('page-blob-2')
    expect(out.redirectNotice).toMatch(/\/about → \/who-we-are/)
  })

  it('writes just the page when no row shadows it', async () => {
    h.redirects = `${H}/x,/about,301,points-in\n`
    const out = await writeNewPage('repo', 'content/pages/about.md', '/about', 'body', 'm', {})
    expect(h.writeFiles).not.toHaveBeenCalled()
    expect(h.writeFile).toHaveBeenCalledTimes(1)
    expect(out).toEqual({ blobSha: 'page-blob-1' })
  })

  it('writes just the page when the site has no redirects.csv', async () => {
    h.redirects = null
    await writeNewPage('repo', 'content/pages/about.md', '/about', 'body', 'm', {})
    expect(h.writeFile).toHaveBeenCalledTimes(1)
  })
})

describe('planRedirectClear', () => {
  it('clears rows for every url given', async () => {
    h.redirects = `${H}/a,/z,301,x\n/b,/z,301,x\n/c,/z,301,x\n`
    const plan = await planRedirectClear('repo', ['/a', '/b'])
    expect(plan?.companion.content).toBe(`${H}/c,/z,301,x\n`)
    expect(plan?.companion.expectedSha).toBe('redirects-sha')
  })
})
