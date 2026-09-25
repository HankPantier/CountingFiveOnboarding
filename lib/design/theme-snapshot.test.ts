import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ ensure: vi.fn(), listTree: vi.fn(), readTextBlobs: vi.fn() }))

vi.mock('@/lib/github/repo-files', () => ({
  DRAFT_BRANCH: 'draft',
  ensureDraftBranch: (slug: string) => m.ensure(slug),
  listTree: (...a: unknown[]) => m.listTree(...a),
  readTextBlobs: (...a: unknown[]) => m.readTextBlobs(...a),
}))

import { readDraftThemeSnapshot, __resetThemeBlobCacheForTests } from './theme-snapshot'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const TREE = [
  { path: 'content/brand.json', sha: A, type: 'blob' },
  { path: 'content/design.json', sha: B, type: 'blob' },
  { path: 'src/styles/theme.css', sha: C, type: 'blob' },
  { path: 'content/pages/home.md', sha: 'd'.repeat(40), type: 'blob' },
  { path: 'content', sha: 'e'.repeat(40), type: 'tree' },
]

beforeEach(() => {
  __resetThemeBlobCacheForTests()
  m.ensure.mockReset().mockResolvedValue(undefined)
  m.listTree.mockReset().mockResolvedValue(TREE)
  m.readTextBlobs.mockReset().mockImplementation(async (_repo: string, entries: { path: string }[]) =>
    entries.map((e) => ({ path: e.path, content: `text:${e.path}` }))
  )
})

describe('readDraftThemeSnapshot', () => {
  it('returns blob shas + texts for the theme files only', async () => {
    const snap = await readDraftThemeSnapshot('o/r')
    expect(m.ensure).toHaveBeenCalledWith('o/r')
    expect(m.listTree).toHaveBeenCalledWith('o/r', 'draft')
    expect(snap.shas).toEqual({ 'content/brand.json': A, 'content/design.json': B, 'src/styles/theme.css': C })
    expect(snap.texts).toEqual({
      'content/brand.json': 'text:content/brand.json',
      'content/design.json': 'text:content/design.json',
      'src/styles/theme.css': 'text:src/styles/theme.css',
    })
  })

  it('serves unchanged blobs from the sha cache', async () => {
    await readDraftThemeSnapshot('o/r')
    await readDraftThemeSnapshot('o/r')
    expect(m.readTextBlobs).toHaveBeenCalledTimes(1)
  })

  it('re-reads only the blob whose sha changed', async () => {
    await readDraftThemeSnapshot('o/r')
    const D = 'f'.repeat(40)
    m.listTree.mockResolvedValue(TREE.map((e) => (e.path === 'src/styles/theme.css' ? { ...e, sha: D } : e)))
    await readDraftThemeSnapshot('o/r')
    expect(m.readTextBlobs).toHaveBeenLastCalledWith('o/r', [{ path: 'src/styles/theme.css', sha: D, type: 'blob' }])
  })
})
