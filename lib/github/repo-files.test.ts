import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RequestError } from '@octokit/request-error'

const getContent = vi.fn()
const getRef = vi.fn()
const getCommit = vi.fn()
const createTree = vi.fn()
const createCommit = vi.fn()
const updateRef = vi.fn()

vi.mock('./app-client', () => ({
  getOctokit: () => ({
    repos: { getContent },
    git: { getRef, getCommit, createTree, createCommit, updateRef },
  }),
  resolveRepo: () => ({ owner: 'cf', repo: 'site' }),
}))

import { moveFile, FileNotFoundError, StaleShaError, AssetExistsError } from './repo-files'

function notFound(): RequestError {
  return new RequestError('Not Found', 404, {
    request: { method: 'GET', url: 'https://api.github.com', headers: {} },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('moveFile', () => {
  const from = 'content/pages/a.md'
  const to = 'content/drafts/pages/a.md'

  it('commits a tree with the new-path blob and a null delete entry', async () => {
    getContent
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'blob1' } }) // fromPath sha
      .mockRejectedValueOnce(notFound()) // toPath absent
    getRef.mockResolvedValue({ data: { object: { sha: 'baseCommit' } } })
    getCommit.mockResolvedValue({ data: { tree: { sha: 'baseTree' } } })
    createTree.mockResolvedValue({ data: { sha: 'newTree' } })
    createCommit.mockResolvedValue({ data: { sha: 'newCommit' } })
    updateRef.mockResolvedValue({})

    const res = await moveFile('site', from, to, 'draft', 'blob1', 'msg')

    expect(res).toEqual({ commitSha: 'newCommit' })
    const treeArg = createTree.mock.calls[0][0] as {
      base_tree: string
      tree: unknown[]
    }
    expect(treeArg.base_tree).toBe('baseTree')
    expect(treeArg.tree).toEqual([
      { path: to, mode: '100644', type: 'blob', sha: 'blob1' },
      { path: from, mode: '100644', type: 'blob', sha: null },
    ])
    expect(updateRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'heads/draft', sha: 'newCommit' })
    )
  })

  it('throws FileNotFoundError when the source is missing', async () => {
    getContent.mockRejectedValueOnce(notFound())
    await expect(moveFile('site', from, to, 'draft', 'blob1', 'm')).rejects.toBeInstanceOf(
      FileNotFoundError
    )
  })

  it('throws StaleShaError when expectedSha does not match', async () => {
    getContent.mockResolvedValueOnce({ data: { type: 'file', sha: 'serverSha' } })
    await expect(moveFile('site', from, to, 'draft', 'clientSha', 'm')).rejects.toBeInstanceOf(
      StaleShaError
    )
  })

  it('throws AssetExistsError when the destination already exists', async () => {
    getContent
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'blob1' } }) // fromPath
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'blob2' } }) // toPath exists
    await expect(moveFile('site', from, to, 'draft', 'blob1', 'm')).rejects.toBeInstanceOf(
      AssetExistsError
    )
  })
})
