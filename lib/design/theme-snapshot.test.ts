import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ ensure: vi.fn(), listTree: vi.fn(), readTextBlobs: vi.fn() }))

vi.mock('@/lib/github/repo-files', () => ({
  DRAFT_BRANCH: 'draft',
  ensureDraftBranch: (slug: string) => m.ensure(slug),
  listTree: (...a: unknown[]) => m.listTree(...a),
  readTextBlobs: (...a: unknown[]) => m.readTextBlobs(...a),
}))

import {
  MISSING_THEME_FILES_ERROR,
  readDraftThemeSnapshot,
  readDraftThemeTexts,
  themeTextsFromSnapshot,
  __resetThemeBlobCacheForTests,
} from './theme-snapshot'

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

describe('themeTextsFromSnapshot', () => {
  it('returns the four texts (missing css files as empty) plus the shas', () => {
    const r = themeTextsFromSnapshot({
      shas: { 'content/brand.json': A, 'content/design.json': B },
      texts: { 'content/brand.json': '{"b":1}', 'content/design.json': '{"d":1}' },
    })
    expect(r).toEqual({
      ok: true,
      files: { brandText: '{"b":1}', designText: '{"d":1}', themeCss: '', overridesCss: '' },
      shas: { 'content/brand.json': A, 'content/design.json': B },
    })
  })
  it.each([
    ['brand.json', { 'content/design.json': '{}' }],
    ['design.json', { 'content/brand.json': '{}' }],
    ['a non-empty brand.json', { 'content/brand.json': '', 'content/design.json': '{}' }],
  ])('reports missing theme files without %s', (_label, texts) => {
    expect(themeTextsFromSnapshot({ shas: {}, texts })).toEqual({ ok: false, reason: 'missing_theme_files', error: MISSING_THEME_FILES_ERROR })
  })
})

describe('readDraftThemeTexts', () => {
  it('reads the draft snapshot and maps it', async () => {
    const r = await readDraftThemeTexts('o/r')
    expect(m.listTree).toHaveBeenCalledWith('o/r', 'draft')
    expect(r).toEqual({
      ok: true,
      files: {
        brandText: 'text:content/brand.json',
        designText: 'text:content/design.json',
        themeCss: 'text:src/styles/theme.css',
        overridesCss: '',
      },
      shas: { 'content/brand.json': A, 'content/design.json': B, 'src/styles/theme.css': C },
    })
  })
  it('reports a site without design.json', async () => {
    m.listTree.mockResolvedValue(TREE.filter((e) => e.path !== 'content/design.json'))
    expect((await readDraftThemeTexts('o/r')).ok).toBe(false)
  })
})
