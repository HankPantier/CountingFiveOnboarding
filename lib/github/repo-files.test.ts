import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RequestError } from '@octokit/request-error'

const getContent = vi.fn()
const getRef = vi.fn()
const getCommit = vi.fn()
const createTree = vi.fn()
const createCommit = vi.fn()
const updateRef = vi.fn()
const compareCommits = vi.fn()
const merge = vi.fn()
const pullsList = vi.fn()
const pullsCreate = vi.fn()

vi.mock('./app-client', () => ({
  getOctokit: () => ({
    repos: { getContent, compareCommits, merge },
    git: { getRef, getCommit, createTree, createCommit, updateRef },
    pulls: { list: pullsList, create: pullsCreate },
  }),
  resolveRepo: () => ({ owner: 'cf', repo: 'site' }),
}))

import {
  moveFile,
  mergeDraftToMain,
  syncMainIntoDraft,
  FileNotFoundError,
  StaleShaError,
  AssetExistsError,
} from './repo-files'

function notFound(): RequestError {
  return new RequestError('Not Found', 404, {
    request: { method: 'GET', url: 'https://api.github.com', headers: {} },
  })
}

function reqError(status: number, message: string): RequestError {
  return new RequestError(message, status, {
    request: { method: 'POST', url: 'https://api.github.com', headers: {} },
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

describe('mergeDraftToMain', () => {
  it('reports merged with no commit when draft is not ahead', async () => {
    compareCommits.mockResolvedValue({ data: { ahead_by: 0 } })
    const res = await mergeDraftToMain('site')
    expect(res).toEqual({ merged: true, mergeCommitSha: '' })
    expect(merge).not.toHaveBeenCalled()
  })

  it('fast-forward merges when there is no conflict', async () => {
    compareCommits.mockResolvedValue({ data: { ahead_by: 3 } })
    merge.mockResolvedValue({ data: { sha: 'mergeSha' } })
    const res = await mergeDraftToMain('site')
    expect(res).toEqual({ merged: true, mergeCommitSha: 'mergeSha' })
  })

  it('opens a PR on conflict when none exists', async () => {
    compareCommits.mockResolvedValue({ data: { ahead_by: 3 } })
    merge.mockRejectedValue(reqError(409, 'Merge conflict'))
    pullsList.mockResolvedValue({ data: [] })
    pullsCreate.mockResolvedValue({ data: { html_url: 'https://github.com/cf/site/pull/7' } })
    const res = await mergeDraftToMain('site')
    expect(res).toEqual({ merged: false, prUrl: 'https://github.com/cf/site/pull/7' })
  })

  it('reuses the open PR on conflict instead of failing to create a duplicate', async () => {
    compareCommits.mockResolvedValue({ data: { ahead_by: 3 } })
    merge.mockRejectedValue(reqError(409, 'Merge conflict'))
    pullsList.mockResolvedValue({ data: [{ html_url: 'https://github.com/cf/site/pull/3' }] })
    const res = await mergeDraftToMain('site')
    expect(res).toEqual({ merged: false, prUrl: 'https://github.com/cf/site/pull/3' })
    expect(pullsCreate).not.toHaveBeenCalled()
  })

  it('recovers when create races into an existing-PR 422', async () => {
    compareCommits.mockResolvedValue({ data: { ahead_by: 3 } })
    merge.mockRejectedValue(reqError(409, 'Merge conflict'))
    pullsList
      .mockResolvedValueOnce({ data: [] }) // first lookup: none
      .mockResolvedValueOnce({ data: [{ html_url: 'https://github.com/cf/site/pull/9' }] }) // after 422
    pullsCreate.mockRejectedValue(
      reqError(422, 'A pull request already exists for cf:draft.')
    )
    const res = await mergeDraftToMain('site')
    expect(res).toEqual({ merged: false, prUrl: 'https://github.com/cf/site/pull/9' })
  })
})

describe('syncMainIntoDraft', () => {
  it('reports already-current when main is not ahead of draft', async () => {
    compareCommits.mockResolvedValue({ data: { ahead_by: 0 } })
    const res = await syncMainIntoDraft('site')
    expect(res).toEqual({ synced: true, alreadyCurrent: true, mergeCommitSha: null })
    expect(merge).not.toHaveBeenCalled()
  })

  it('merges live into draft when main has new commits', async () => {
    compareCommits.mockResolvedValue({ data: { ahead_by: 4 } })
    merge.mockResolvedValue({ data: { sha: 'draftMergeSha' } })
    const res = await syncMainIntoDraft('site')
    expect(res).toEqual({ synced: true, alreadyCurrent: false, mergeCommitSha: 'draftMergeSha' })
    // Merge direction must be main -> draft (base draft, head main).
    expect(merge).toHaveBeenCalledWith(
      expect.objectContaining({ base: 'draft', head: 'main' })
    )
  })

  it('reports a conflict without forcing anything', async () => {
    compareCommits.mockResolvedValue({ data: { ahead_by: 4 } })
    merge.mockRejectedValue(reqError(409, 'Merge conflict'))
    const res = await syncMainIntoDraft('site')
    expect(res).toMatchObject({ synced: false })
    if (!res.synced) expect(res.reason).toMatch(/conflict/i)
  })
})
