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
const createBlob = vi.fn()
const getBlob = vi.fn()
const getTree = vi.fn()
const listCommits = vi.fn()
const createRef = vi.fn()
const reposGetCommit = vi.fn()
const createOrUpdateFileContents = vi.fn()

vi.mock('./app-client', () => ({
  getOctokit: () => ({
    repos: { getContent, compareCommits, merge, getCommit: reposGetCommit, createOrUpdateFileContents, listCommits },
    git: { getRef, getCommit, createTree, createCommit, updateRef, createBlob, getBlob, createRef, getTree },
    pulls: { list: pullsList, create: pullsCreate },
  }),
  resolveRepo: () => ({ owner: 'cf', repo: 'site' }),
}))

import {
  moveFile,
  pushEntriesToBranch,
  writeFiles,
  writeFile,
  revertFileToMain,
  fastForwardDraftToMain,
  ensureDraftBranch,
  walkNewCommitFileStats,
  getDraftChanges,
  readTextBlobs,
  IncrementalWalkUnavailableError,
  __resetBranchMemoForTests,
    mergeDraftToMain,
  syncMainIntoDraft,
  getDraftHeadSha,
  findLastDeployCommitSha,
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

  beforeEach(() => {
    getRef.mockResolvedValue({ data: { object: { sha: 'baseCommit' } } })
    getCommit.mockResolvedValue({ data: { tree: { sha: 'baseTree' } } })
  })

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
    // The sha checks are pinned to the base COMMIT, not the moving branch.
    expect(getContent.mock.calls[0][0]).toMatchObject({ path: from, ref: 'baseCommit' })
  })

  it('re-validates on the new tip after a ref race (catches a concurrent edit)', async () => {
    getRef
      .mockResolvedValueOnce({ data: { object: { sha: 'tip1' } } })
      .mockResolvedValueOnce({ data: { object: { sha: 'tip2' } } })
    getContent
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'blob1' } }) // from @tip1
      .mockRejectedValueOnce(notFound()) // to @tip1
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'edited' } }) // from @tip2 — changed
    createTree.mockResolvedValue({ data: { sha: 'newTree' } })
    createCommit.mockResolvedValue({ data: { sha: 'newCommit' } })
    updateRef.mockRejectedValueOnce(reqError(422, 'Update is not a fast forward'))
    await expect(moveFile('site', from, to, 'draft', 'blob1', 'm')).rejects.toBeInstanceOf(StaleShaError)
    expect(updateRef).toHaveBeenCalledTimes(1)
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

describe('getDraftHeadSha', () => {
  it('returns the draft branch tip sha regardless of ahead/behind vs main', async () => {
    // Real branch tip — present even when draft is identical to main (0 ahead).
    getRef.mockResolvedValue({ data: { object: { sha: 'draftTipSha' } } })
    const sha = await getDraftHeadSha('site')
    expect(sha).toBe('draftTipSha')
    expect(getRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'heads/draft' })
    )
    // Must not depend on the main...draft comparison (which is empty when up to date).
    expect(compareCommits).not.toHaveBeenCalled()
  })
})

describe('syncMainIntoDraft', () => {
  it('reports already-current when main is not ahead of draft', async () => {
    compareCommits.mockResolvedValue({ data: { ahead_by: 0 } })
    const res = await syncMainIntoDraft('site')
    expect(res).toEqual({ synced: true, alreadyCurrent: true, mergeCommitSha: null })
    expect(merge).not.toHaveBeenCalled()
  })

  it('fast-forwards draft to main when draft has no commits of its own', async () => {
    // Draft strictly behind (main ahead, no draft-only commits) → move the ref, no merge.
    compareCommits.mockResolvedValue({ data: { ahead_by: 1, behind_by: 0 } })
    getRef.mockResolvedValue({ data: { object: { sha: 'mainHeadSha' } } })
    updateRef.mockResolvedValue({})
    const res = await syncMainIntoDraft('site')
    expect(res).toEqual({ synced: true, alreadyCurrent: false, mergeCommitSha: null })
    expect(merge).not.toHaveBeenCalled()
    expect(updateRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'heads/draft', sha: 'mainHeadSha', force: false })
    )
  })

  it('merges live into draft when both branches have diverged', async () => {
    compareCommits.mockResolvedValue({ data: { ahead_by: 4, behind_by: 2 } })
    merge.mockResolvedValue({ data: { sha: 'draftMergeSha' } })
    const res = await syncMainIntoDraft('site')
    expect(res).toEqual({ synced: true, alreadyCurrent: false, mergeCommitSha: 'draftMergeSha' })
    // Merge direction must be main -> draft (base draft, head main).
    expect(merge).toHaveBeenCalledWith(
      expect.objectContaining({ base: 'draft', head: 'main' })
    )
    expect(updateRef).not.toHaveBeenCalled()
  })

  it('reports a conflict without forcing anything', async () => {
    compareCommits.mockResolvedValue({ data: { ahead_by: 4, behind_by: 2 } })
    merge.mockRejectedValue(reqError(409, 'Merge conflict'))
    const res = await syncMainIntoDraft('site')
    expect(res).toMatchObject({ synced: false })
    if (!res.synced) expect(res.reason).toMatch(/conflict/i)
  })
})

describe('pushEntriesToBranch', () => {
  beforeEach(() => {
    getRef.mockResolvedValue({ data: { object: { sha: 'tip' } } })
    getCommit.mockResolvedValue({ data: { tree: { sha: 'tree' } } })
    createBlob.mockResolvedValue({ data: { sha: 'newblob' } })
    createTree.mockResolvedValue({ data: { sha: 'newTree' } })
    createCommit.mockResolvedValue({ data: { sha: 'newCommit' } })
    updateRef.mockResolvedValue({})
  })

  it('uploads blobs once even when the ref race forces a retry', async () => {
    updateRef.mockRejectedValueOnce(reqError(422, 'Update is not a fast forward')).mockResolvedValue({})
    await pushEntriesToBranch('site', 'draft', [{ path: 'a.md', content: 'x' }, { path: 'b.md', content: 'y' }], 'm')
    expect(createBlob).toHaveBeenCalledTimes(2)
    expect(createCommit).toHaveBeenCalledTimes(2)
  })

  it('rejects a lost update when expectedBlobSha no longer matches the base tree', async () => {
    getContent
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'someoneElse' } }) // sha check @tip
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'someoneElse', content: Buffer.from('theirs').toString('base64'), encoding: 'base64' } })
    const err = await pushEntriesToBranch(
      'site',
      'draft',
      [{ path: 'content/posts/a.md', content: 'mine', expectedBlobSha: 'readSha' }],
      'm'
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StaleShaError)
    expect((err as StaleShaError).currentContent).toBe('theirs')
    expect(updateRef).not.toHaveBeenCalled()
  })

  it('commits when expectedBlobSha matches', async () => {
    getContent.mockResolvedValueOnce({ data: { type: 'file', sha: 'readSha' } })
    const res = await pushEntriesToBranch(
      'site',
      'draft',
      [{ path: 'content/posts/a.md', content: 'mine', expectedBlobSha: 'readSha' }],
      'm'
    )
    expect(res).toEqual({ commitSha: 'newCommit', fileCount: 1 })
  })

  it('validates many guarded entries against ONE base-tree read', async () => {
    getRef.mockResolvedValue({ data: { object: { sha: 'guardTip' } } })
    getCommit.mockResolvedValue({ data: { tree: { sha: 'guardTree' } } })
    const entries: { path: string; content: string; expectedBlobSha: string | null }[] = Array.from(
      { length: 10 },
      (_, i) => ({ path: `content/pages/p${i}.md`, content: `new ${i}`, expectedBlobSha: `s${i}` })
    )
    entries.push({ path: 'content/pages/fresh.md', content: 'x', expectedBlobSha: null })
    getTree.mockResolvedValue({
      data: {
        tree: entries
          .filter((e) => e.expectedBlobSha)
          .map((e) => ({ path: e.path, sha: e.expectedBlobSha, type: 'blob' })),
      },
    })
    await pushEntriesToBranch('site', 'draft', entries, 'm')
    expect(getTree).toHaveBeenCalledTimes(1)
    expect(getContent).not.toHaveBeenCalled()
    expect(updateRef).toHaveBeenCalledTimes(1)
  })

  it('a tree-read mismatch still aborts with StaleShaError before committing', async () => {
    getRef.mockResolvedValue({ data: { object: { sha: 'guardTip2' } } })
    getCommit.mockResolvedValue({ data: { tree: { sha: 'guardTree2' } } })
    const entries = Array.from({ length: 10 }, (_, i) => ({
      path: `content/pages/q${i}.md`,
      content: `new ${i}`,
      expectedBlobSha: `s${i}`,
    }))
    getTree.mockResolvedValue({
      data: {
        tree: entries.map((e, i) => ({ path: e.path, sha: i === 3 ? 'operatorEdit' : e.expectedBlobSha, type: 'blob' })),
      },
    })
    getContent
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'operatorEdit' } })
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'operatorEdit', content: '', encoding: 'base64' } })
    await expect(pushEntriesToBranch('site', 'draft', entries, 'm')).rejects.toBeInstanceOf(StaleShaError)
    expect(getContent.mock.calls[0][0]).toMatchObject({ path: 'content/pages/q3.md', ref: 'guardTip2' })
    expect(updateRef).not.toHaveBeenCalled()
  })

  it('expectedBlobSha: null requires the path to be absent', async () => {
    getContent.mockResolvedValueOnce({ data: { type: 'file', sha: 'exists' } })
    getContent.mockResolvedValueOnce({ data: { type: 'file', sha: 'exists', content: '', encoding: 'base64' } })
    await expect(
      pushEntriesToBranch('site', 'draft', [{ path: 'n.md', content: 'x', expectedBlobSha: null }], 'm')
    ).rejects.toBeInstanceOf(StaleShaError)
  })
})

describe('writeFiles', () => {
  it('validates expectedSha inside each attempt (stale after a ref race)', async () => {
    getRef
      .mockResolvedValueOnce({ data: { object: { sha: 'tip1' } } })
      .mockResolvedValueOnce({ data: { object: { sha: 'tip2' } } })
    getCommit.mockResolvedValue({ data: { tree: { sha: 'tree' } } })
    createBlob.mockResolvedValue({ data: { sha: 'nb' } })
    createTree.mockResolvedValue({ data: { sha: 'nt' } })
    createCommit.mockResolvedValue({ data: { sha: 'nc' } })
    getContent
      .mockResolvedValueOnce({ data: { type: 'file', sha: 's1' } }) // @tip1 ok
      .mockResolvedValueOnce({ data: { type: 'file', sha: 's2' } }) // @tip2 moved
      .mockResolvedValueOnce({ data: { type: 'file', sha: 's2', content: '', encoding: 'base64' } })
    updateRef.mockRejectedValueOnce(reqError(422, 'Update is not a fast forward'))
    await expect(
      writeFiles('site', [{ path: 'content/brand.json', content: '{}', expectedSha: 's1' }], 'draft', 'm')
    ).rejects.toBeInstanceOf(StaleShaError)
    expect(createBlob).toHaveBeenCalledTimes(1)
  })

  it('expectedSha null = must be absent: a concurrently created file → StaleShaError, nothing committed', async () => {
    getRef.mockResolvedValue({ data: { object: { sha: 'tip' } } })
    getCommit.mockResolvedValue({ data: { tree: { sha: 'tree' } } })
    createBlob.mockResolvedValue({ data: { sha: 'nb' } })
    getContent
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'created' } }) // exists at the tip
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'created', content: '', encoding: 'base64' } })
    await expect(
      writeFiles('site', [{ path: 'content/design-overrides.css', content: 'x', expectedSha: null }], 'draft', 'm')
    ).rejects.toBeInstanceOf(StaleShaError)
    expect(createTree).not.toHaveBeenCalled()
    expect(createCommit).not.toHaveBeenCalled()
    expect(updateRef).not.toHaveBeenCalled()
  })

  it('expectedSha null passes when the file is still absent', async () => {
    getRef.mockResolvedValue({ data: { object: { sha: 'tip' } } })
    getCommit.mockResolvedValue({ data: { tree: { sha: 'tree' } } })
    createBlob.mockResolvedValue({ data: { sha: 'nb' } })
    createTree.mockResolvedValue({ data: { sha: 'nt' } })
    createCommit.mockResolvedValue({ data: { sha: 'nc' } })
    updateRef.mockResolvedValue({ data: {} })
    getContent.mockRejectedValueOnce(notFound())
    const r = await writeFiles('site', [{ path: 'content/design-overrides.css', content: 'x', expectedSha: null }], 'draft', 'm')
    expect(r).toEqual({ commitSha: 'nc', blobs: { 'content/design-overrides.css': 'nb' } })
  })
})

describe('writeFile', () => {
  it('retries a transient 409 when the file sha still matches', async () => {
    getContent.mockResolvedValue({ data: { type: 'file', sha: 's1', content: '', encoding: 'base64' } })
    createOrUpdateFileContents
      .mockRejectedValueOnce(reqError(409, 'is at abc but expected def'))
      .mockResolvedValueOnce({ data: { commit: { sha: 'c' }, content: { sha: 'b' } } })
    const res = await writeFile('site', 'content/pages/a.md', 'x', 'draft', 'm', { expectedSha: 's1' })
    expect(res).toEqual({ commitSha: 'c', blobSha: 'b' })
    expect(createOrUpdateFileContents).toHaveBeenCalledTimes(2)
  })

  it('does not pre-read the branch (a lagged read of our own last commit is not a conflict)', async () => {
    // A lagged branch read would still show the blob before our previous
    // commit; the Contents API enforces `sha` itself, so no read happens.
    getContent.mockResolvedValue({ data: { type: 'file', sha: 'previousBlob', content: '', encoding: 'base64' } })
    createOrUpdateFileContents.mockResolvedValueOnce({ data: { commit: { sha: 'c' }, content: { sha: 'b2' } } })
    const res = await writeFile('site', 'content/pages/a.md', 'x', 'draft', 'm', { expectedSha: 'justWritten' })
    expect(res).toEqual({ commitSha: 'c', blobSha: 'b2' })
    expect(getContent).not.toHaveBeenCalled()
    expect(createOrUpdateFileContents.mock.calls[0][0]).toMatchObject({ sha: 'justWritten' })
    getContent.mockReset()
  })

  it('maps a 409 caused by a real sha change to StaleShaError', async () => {
    getContent
      .mockResolvedValueOnce({ data: { type: 'file', sha: 's2', content: Buffer.from('new').toString('base64'), encoding: 'base64' } })
    createOrUpdateFileContents.mockRejectedValueOnce(reqError(409, 'conflict'))
    const err = await writeFile('site', 'content/pages/a.md', 'x', 'draft', 'm', { expectedSha: 's1' }).catch(
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(StaleShaError)
    expect((err as StaleShaError).currentSha).toBe('s2')
  })
})

describe('revertFileToMain', () => {
  it("points draft at main's blob sha (no utf-8 round-trip for binaries)", async () => {
    getContent
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'liveBlob' } }) // main
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'draftBlob' } }) // draft
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'draftBlob' } }) // guard @base
    getRef.mockResolvedValue({ data: { object: { sha: 'tip' } } })
    getCommit.mockResolvedValue({ data: { tree: { sha: 'tree' } } })
    createTree.mockResolvedValue({ data: { sha: 'nt' } })
    createCommit.mockResolvedValue({ data: { sha: 'nc' } })
    updateRef.mockResolvedValue({})
    const res = await revertFileToMain('site', 'public/content-assets/a.png', 'draftBlob')
    expect(res).toEqual({ reverted: true, commitSha: 'nc', action: 'restored' })
    expect(createTree.mock.calls[0][0].tree).toEqual([
      { path: 'public/content-assets/a.png', mode: '100644', type: 'blob', sha: 'liveBlob' },
    ])
    expect(createBlob).not.toHaveBeenCalled()
    expect(createOrUpdateFileContents).not.toHaveBeenCalled()
  })

  it('reverts a rename in ONE commit: deletes the new path and restores the old one', async () => {
    const newPath = 'content/drafts/pages/x.md'
    const oldPath = 'content/pages/x.md'
    getContent.mockImplementation(async ({ path, ref }: { path: string; ref: string }) => {
      if (path === newPath && ref === 'main') throw notFound()
      if (path === newPath) return { data: { type: 'file', sha: 'movedBlob' } } // draft + base
      if (path === oldPath && ref === 'main') return { data: { type: 'file', sha: 'liveBlob' } }
      throw notFound() // old path absent on draft + base
    })
    getRef.mockResolvedValue({ data: { object: { sha: 'tip' } } })
    getCommit.mockResolvedValue({ data: { tree: { sha: 'tree' } } })
    createTree.mockResolvedValue({ data: { sha: 'nt' } })
    createCommit.mockResolvedValue({ data: { sha: 'nc' } })
    updateRef.mockResolvedValue({})

    const res = await revertFileToMain('site', newPath, 'movedBlob', {}, oldPath)

    expect(res).toEqual({ reverted: true, commitSha: 'nc', action: 'restored' })
    expect(createTree).toHaveBeenCalledTimes(1)
    expect(createTree.mock.calls[0][0].tree).toEqual([
      { path: newPath, mode: '100644', type: 'blob', sha: null },
      { path: oldPath, mode: '100644', type: 'blob', sha: 'liveBlob' },
    ])
    expect(createOrUpdateFileContents).not.toHaveBeenCalled()
    getContent.mockReset()
  })

  it('rename revert 409s when the moved copy was edited since the list loaded', async () => {
    getContent.mockImplementation(async ({ path, ref }: { path: string; ref: string }) => {
      if (path === 'content/drafts/pages/x.md' && ref === 'draft') return { data: { type: 'file', sha: 'editedAgain' } }
      if (path === 'content/pages/x.md' && ref === 'main') return { data: { type: 'file', sha: 'liveBlob' } }
      throw notFound()
    })
    await expect(
      revertFileToMain('site', 'content/drafts/pages/x.md', 'movedBlob', {}, 'content/pages/x.md')
    ).rejects.toBeInstanceOf(StaleShaError)
    expect(createTree).not.toHaveBeenCalled()
    getContent.mockReset()
  })

  it('409s (StaleShaError) when the draft moved since the caller looked', async () => {
    getContent
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'liveBlob' } })
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'newer' } })
    await expect(revertFileToMain('site', 'content/pages/a.md', 'draftBlob')).rejects.toBeInstanceOf(StaleShaError)
  })
})

describe('fastForwardDraftToMain', () => {
  it('moves draft with force:false', async () => {
    getRef.mockResolvedValue({ data: { object: { sha: 'mainTip' } } })
    updateRef.mockResolvedValue({})
    expect(await fastForwardDraftToMain('site')).toBe(true)
    expect(updateRef).toHaveBeenCalledWith(expect.objectContaining({ ref: 'heads/draft', sha: 'mainTip', force: false }))
  })

  it('leaves draft alone (no throw) when a post-merge edit makes it non-ff', async () => {
    getRef.mockResolvedValue({ data: { object: { sha: 'mainTip' } } })
    updateRef.mockRejectedValue(reqError(422, 'Update is not a fast forward'))
    expect(await fastForwardDraftToMain('site')).toBe(false)
    for (const call of updateRef.mock.calls) expect(call[0]).not.toHaveProperty('force', true)
  })
})

describe('ensureDraftBranch', () => {
  beforeEach(() => __resetBranchMemoForTests())

  it('treats a create race ("Reference already exists") as success and memoizes', async () => {
    getRef.mockRejectedValueOnce(notFound()).mockResolvedValueOnce({ data: { object: { sha: 'mainTip' } } })
    createRef.mockRejectedValueOnce(reqError(422, 'Reference already exists'))
    await expect(ensureDraftBranch('site')).resolves.toBeUndefined()
    getRef.mockClear()
    await ensureDraftBranch('site')
    expect(getRef).not.toHaveBeenCalled()
  })
})

describe('walkNewCommitFileStats', () => {
  it('refuses to fold a diverged comparison (draft was reset)', async () => {
    compareCommits.mockResolvedValue({ data: { status: 'diverged', total_commits: 1, commits: [{ sha: 'x', commit: {} }] } })
    await expect(walkNewCommitFileStats('site', 'old')).rejects.toBeInstanceOf(IncrementalWalkUnavailableError)
  })

  it('refuses a truncated commit list', async () => {
    compareCommits.mockResolvedValue({ data: { status: 'ahead', total_commits: 300, commits: [{ sha: 'x', commit: {} }] } })
    await expect(walkNewCommitFileStats('site', 'old')).rejects.toBeInstanceOf(IncrementalWalkUnavailableError)
  })

  it('returns [] when identical', async () => {
    compareCommits.mockResolvedValue({ data: { status: 'identical', total_commits: 0, commits: [] } })
    expect(await walkNewCommitFileStats('site', 'old')).toEqual([])
  })
})

describe('getDraftChanges', () => {
  it('caches per-commit file lists by sha across calls', async () => {
    const commit = (sha: string) => ({ sha, commit: { message: sha, author: { name: 'A', email: 'a@x', date: null } } })
    compareCommits.mockResolvedValue({
      data: {
        commits: [commit('cacheC1'), commit('cacheC2')],
        files: [{ filename: 'content/pages/a.md', status: 'modified', additions: 1, deletions: 0, sha: 'b', patch: '@@' }],
      },
    })
    reposGetCommit.mockImplementation(async ({ ref }: { ref: string }) => ({
      data: { files: ref === 'cacheC2' ? [{ filename: 'content/pages/a.md' }] : [] },
    }))
    const first = await getDraftChanges('site')
    expect(first.files[0].message).toBe('cacheC2')
    expect(reposGetCommit).toHaveBeenCalledTimes(2)
    await getDraftChanges('site')
    expect(reposGetCommit).toHaveBeenCalledTimes(2)
  })
})

describe('readTextBlobs', () => {
  it('reads by blob sha with getBlob only, preserving order', async () => {
    getBlob.mockImplementation(async ({ file_sha }: { file_sha: string }) => ({
      data: { content: Buffer.from(`body-${file_sha}`).toString('base64'), encoding: 'base64' },
    }))
    const out = await readTextBlobs('site', [
      { path: 'a.md', sha: '1' },
      { path: 'b.md', sha: '2' },
    ])
    expect(out).toEqual([
      { path: 'a.md', content: 'body-1' },
      { path: 'b.md', content: 'body-2' },
    ])
    expect(getContent).not.toHaveBeenCalled()
  })
})

describe('findLastDeployCommitSha', () => {
  it('returns the newest deploy commit touching brand.md, ignoring editor commits', async () => {
    listCommits.mockResolvedValueOnce({
      data: [
        { sha: 'edit1', commit: { message: 'Update brand.md via admin' } },
        { sha: 'dep2', commit: { message: 'Deploy packaged content via admin (a@x)' } },
        { sha: 'dep1', commit: { message: 'Deploy packaged content via admin' } },
      ],
    })
    expect(await findLastDeployCommitSha('site')).toBe('dep2')
    expect(listCommits.mock.calls[0][0]).toMatchObject({ sha: 'draft', path: 'content/brand.md' })
  })

  it('returns null for a never-deployed site', async () => {
    listCommits.mockResolvedValueOnce({ data: [] })
    expect(await findLastDeployCommitSha('site')).toBeNull()
  })
})
