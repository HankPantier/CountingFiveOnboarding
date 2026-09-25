import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const files = new Map<string, { content: string; sha: string }>()
const writeFiles = vi.fn()

vi.mock('@/lib/github/repo-files', () => {
  class FileNotFoundError extends Error {}
  return {
    DRAFT_BRANCH: 'draft',
    FileNotFoundError,
    ensureDraftBranch: vi.fn(async () => undefined),
    readFile: vi.fn(async (_repo: string, p: string) => {
      const f = files.get(p)
      if (!f) throw new FileNotFoundError(p)
      return { path: p, ...f }
    }),
    writeFiles: (...args: unknown[]) => writeFiles(...args),
  }
})

import { readFile } from '@/lib/github/repo-files'
import { applyBundleToDraft } from './apply-bundle'
import { readRegion } from './bundle-files'
import { VALID } from './__fixtures__/valid-bundle'

const FIX = path.join(__dirname, '..', 'content', '__fixtures__')
const AUTHOR = { name: 'Admin', email: 'a@example.com' }

beforeEach(() => {
  files.clear()
  writeFiles.mockReset()
  writeFiles.mockResolvedValue({ commitSha: 'c1', blobs: { 'content/brand.json': 'b1' } })
  files.set('content/brand.json', { content: readFileSync(path.join(FIX, 'brand.golden.json'), 'utf-8'), sha: 'sb' })
  files.set('content/design.json', { content: readFileSync(path.join(FIX, 'design.golden.json'), 'utf-8'), sha: 'sd' })
})

describe('applyBundleToDraft', () => {
  it('commits every changed theme file in ONE writeFiles call with expected shas', async () => {
    const r = await applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'Design: apply', author: AUTHOR })
    expect(r.ok).toBe(true)
    expect(writeFiles).toHaveBeenCalledTimes(1)
    const [repo, changes, branch, message, opts] = writeFiles.mock.calls[0]
    expect(repo).toBe('o/r')
    expect(branch).toBe('draft')
    expect(message).toBe('Design: apply')
    expect(opts).toEqual({ authorName: 'Admin', authorEmail: 'a@example.com' })
    const byPath = Object.fromEntries((changes as { path: string; expectedSha?: string }[]).map((c) => [c.path, c.expectedSha]))
    expect(byPath['content/brand.json']).toBe('sb')
    expect(byPath['content/design.json']).toBe('sd')
    expect('src/styles/theme.css' in byPath).toBe(true)
    expect(byPath['src/styles/theme.css']).toBeUndefined() // file did not exist
    expect('content/design-overrides.css' in byPath).toBe(true)
    if (r.ok) {
      expect(r.changedPaths).toContain('content/brand.json')
      // CONTROLLER RULING: the success variant must pass through the sanitized,
      // canonical CSS actually written (rendered.css), not the bundle's raw css —
      // verify it matches what's actually inside the committed overrides file.
      const overridesChange = (changes as { path: string; content: string }[]).find(
        (c) => c.path === 'content/design-overrides.css'
      )
      const parsedWritten = readRegion(overridesChange?.content ?? '')
      if (!parsedWritten.ok) throw new Error('expected a well-formed written region')
      expect(r.css).toEqual(parsedWritten.css)
      expect(r.css.blocks.hero).toBeTruthy()
    }
  })

  it('returns 409 when brand.json or design.json is missing', async () => {
    files.delete('content/design.json')
    const r = await applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'm', author: AUTHOR })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(writeFiles).not.toHaveBeenCalled()
  })

  it('returns 422 on a contrast failure without committing', async () => {
    const lowContrast = { ...VALID, palette: { ...VALID.palette, nearBlack: '#fafaf6', nearWhite: '#fafaf7' } }
    const r = await applyBundleToDraft({ githubRepo: 'o/r', bundle: lowContrast, removeLegacy: false, message: 'm', author: AUTHOR })
    expect(r).toMatchObject({ ok: false, status: 422 })
    expect(writeFiles).not.toHaveBeenCalled()
  })

  it('returns 422 when the bundle CSS fails the sanitizer', async () => {
    const bad = { ...VALID, css: { blocks: { hero: 'body { display: none; }' } } }
    const r = await applyBundleToDraft({ githubRepo: 'o/r', bundle: bad, removeLegacy: false, message: 'm', author: AUTHOR })
    expect(r).toMatchObject({ ok: false, status: 422 })
    expect(writeFiles).not.toHaveBeenCalled()
  })

  it('returns 422 without committing when design-overrides.css has malformed design-studio markers and removeLegacy is false', async () => {
    files.set('content/design-overrides.css', {
      content: '/* design-studio:begin */\nbroken\n',
      sha: 'so',
    })
    const r = await applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'm', author: AUTHOR })
    expect(r).toMatchObject({ ok: false, status: 422 })
    expect(writeFiles).not.toHaveBeenCalled()
  })

  it('does not commit when nothing changed', async () => {
    const first = await applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'm', author: AUTHOR })
    if (!first.ok) throw new Error('first apply failed')
    // Seed the repo with exactly what the first apply wrote, then re-apply.
    for (const c of writeFiles.mock.calls[0][1] as { path: string; content: string }[]) files.set(c.path, { content: c.content, sha: 'x' })
    writeFiles.mockClear()
    const again = await applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'm', author: AUTHOR })
    expect(again).toMatchObject({ ok: true, commitSha: null, changedPaths: [] })
    expect(writeFiles).not.toHaveBeenCalled()
  })

  it('base mode: renders onto the caller’s base (no branch reads) and sha-guards EVERY base file', async () => {
    const brandText = files.get('content/brand.json')?.content ?? ''
    const designText = files.get('content/design.json')?.content ?? ''
    // A theme.css the bundle will regenerate identically must still be guarded.
    const first = await applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'm', author: AUTHOR })
    if (!first.ok) throw new Error('first apply failed')
    const themeCss = (writeFiles.mock.calls[0][1] as { path: string; content: string }[]).find((c) => c.path === 'src/styles/theme.css')?.content ?? ''
    writeFiles.mockClear()
    vi.mocked(readFile).mockClear()
    files.clear() // a lagging branch read would now 404 — base mode must not read

    const base = {
      shas: { 'content/brand.json': 'B1', 'content/design.json': 'D1', 'src/styles/theme.css': 'T1' },
      texts: { 'content/brand.json': brandText, 'content/design.json': designText, 'src/styles/theme.css': themeCss },
    }
    const r = await applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'm', author: AUTHOR, base })
    expect(r.ok).toBe(true)
    expect(readFile).not.toHaveBeenCalled()
    const changes = writeFiles.mock.calls[0][1] as { path: string; content: string; expectedSha?: string }[]
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c]))
    expect(byPath['content/brand.json'].expectedSha).toBe('B1')
    expect(byPath['content/design.json'].expectedSha).toBe('D1')
    // theme.css is unchanged vs base → rides along as a same-content guard, not a change.
    expect(byPath['src/styles/theme.css']).toEqual({ path: 'src/styles/theme.css', content: themeCss, expectedSha: 'T1' })
    if (r.ok) {
      expect(r.changedPaths).not.toContain('src/styles/theme.css')
      expect(Object.keys(r.blobs).every((p) => r.changedPaths.includes(p))).toBe(true)
    }
  })

  it('base mode: a written file ABSENT from the base is guarded as must-not-exist (null); non-base stays unguarded', async () => {
    const base = {
      shas: { 'content/brand.json': 'B1', 'content/design.json': 'D1' },
      texts: { 'content/brand.json': files.get('content/brand.json')?.content ?? '', 'content/design.json': files.get('content/design.json')?.content ?? '' },
    }
    await applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'm', author: AUTHOR, base })
    const guarded = Object.fromEntries((writeFiles.mock.calls[0][1] as { path: string; expectedSha?: string | null }[]).map((c) => [c.path, c.expectedSha]))
    expect(guarded['src/styles/theme.css']).toBeNull()
    expect(guarded['content/design-overrides.css']).toBeNull()

    writeFiles.mockClear()
    await applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'm', author: AUTHOR })
    const plain = writeFiles.mock.calls[0][1] as { path: string; expectedSha?: string | null }[]
    expect(plain.find((c) => c.path === 'content/design-overrides.css')?.expectedSha).toBeUndefined()
  })

  it('base mode: a concurrent creation of a base-absent file fails the commit (StaleShaError propagates, nothing recorded)', async () => {
    // writeFiles' real null guard (repo-files.test.ts) throws StaleShaError before committing.
    class StaleShaError extends Error {}
    writeFiles.mockRejectedValueOnce(new StaleShaError('content/design-overrides.css'))
    const base = {
      shas: { 'content/brand.json': 'B1', 'content/design.json': 'D1' },
      texts: { 'content/brand.json': files.get('content/brand.json')?.content ?? '', 'content/design.json': files.get('content/design.json')?.content ?? '' },
    }
    await expect(applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'm', author: AUTHOR, base })).rejects.toBeInstanceOf(StaleShaError)
  })

  it('base mode: a base without brand/design texts is a 409', async () => {
    const r = await applyBundleToDraft({ githubRepo: 'o/r', bundle: VALID, removeLegacy: false, message: 'm', author: AUTHOR, base: { shas: {}, texts: {} } })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(writeFiles).not.toHaveBeenCalled()
  })
})
