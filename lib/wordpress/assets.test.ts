import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  FileNotFoundError: class FileNotFoundError extends Error {},
  listTree: vi.fn(),
  readBlobBySha: vi.fn(),
}))

vi.mock('@/lib/github/repo-files', () => ({
  MAIN_BRANCH: 'main',
  FileNotFoundError: h.FileNotFoundError,
  listTree: h.listTree,
  readBlobBySha: h.readBlobBySha,
}))

import { AssetTooLargeError, MAX_ASSET_BYTES, readRepoAsset } from './assets'

const PATH = 'public/content-assets/hero.jpg'

beforeEach(() => {
  h.listTree.mockReset()
  h.readBlobBySha.mockReset()
})

describe('readRepoAsset', () => {
  it('refuses an oversized blob from its tree size WITHOUT downloading it', async () => {
    h.listTree.mockResolvedValue([{ path: PATH, sha: 'big', type: 'blob', size: MAX_ASSET_BYTES + 1 }])
    await expect(readRepoAsset('repo', PATH)).rejects.toBeInstanceOf(AssetTooLargeError)
    expect(h.readBlobBySha).not.toHaveBeenCalled()
  })

  it('reads a normal asset by its tree sha', async () => {
    h.listTree.mockResolvedValue([{ path: PATH, sha: 'small', type: 'blob', size: 3 }])
    h.readBlobBySha.mockResolvedValue(Buffer.from('abc'))
    const blob = await readRepoAsset('repo', PATH)
    expect(blob).toMatchObject({ path: PATH, sha: 'small', size: 3 })
    expect(h.listTree).toHaveBeenCalledWith('repo', 'main', 'public/content-assets/')
    expect(h.readBlobBySha).toHaveBeenCalledWith('repo', 'small')
  })

  it('throws FileNotFoundError for a path not on main', async () => {
    h.listTree.mockResolvedValue([])
    await expect(readRepoAsset('repo', PATH)).rejects.toBeInstanceOf(h.FileNotFoundError)
  })
})
