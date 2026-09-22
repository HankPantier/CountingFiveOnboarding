import { describe, expect, it, vi, beforeEach } from 'vitest'

const getRef = vi.fn()
const getCommit = vi.fn()
const createBlob = vi.fn()
const createTree = vi.fn()
const createCommit = vi.fn()
const updateRef = vi.fn()

vi.mock('./app-client', () => ({
  getOctokit: () => ({
    git: { getRef, getCommit, createBlob, createTree, createCommit, updateRef },
  }),
  resolveRepo: () => ({ owner: 'cf', repo: 'site' }),
}))

import { pushEntriesToBranch } from './repo-files'

function nonFastForward() {
  return Object.assign(new Error('Update is not a fast forward'), { status: 422 })
}

describe('commit ref-race retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRef.mockResolvedValue({ data: { object: { sha: 'tip1' } } })
    getCommit.mockResolvedValue({ data: { tree: { sha: 'tree1' } } })
    createBlob.mockResolvedValue({ data: { sha: 'blob1' } })
    createTree.mockResolvedValue({ data: { sha: 'newtree' } })
    createCommit.mockResolvedValue({ data: { sha: 'newcommit' } })
  })

  it('rebuilds on the new tip when another writer lands first', async () => {
    // A library draft was permanently lost to exactly this: the branch moved
    // between reading the tip and updating the ref, GitHub rejected the push as
    // "not a fast forward", and the article stayed errored forever.
    updateRef.mockRejectedValueOnce(nonFastForward()).mockResolvedValue({})
    getRef
      .mockResolvedValueOnce({ data: { object: { sha: 'tip1' } } })
      .mockResolvedValue({ data: { object: { sha: 'tip2' } } })

    const res = await pushEntriesToBranch('o/r', 'draft', [{ path: 'a.md', content: 'x' }], 'msg')

    expect(res.commitSha).toBe('newcommit')
    expect(updateRef).toHaveBeenCalledTimes(2)
    // The retry must RE-READ the tip, not replay the stale one — otherwise it
    // would fail identically forever.
    expect(getRef).toHaveBeenCalledTimes(2)
    // And the second commit must be parented on the NEW tip.
    expect(createCommit).toHaveBeenLastCalledWith(expect.objectContaining({ parents: ['tip2'] }))
  })

  it('never forces the ref, which would discard the other writer', async () => {
    updateRef.mockRejectedValueOnce(nonFastForward()).mockResolvedValue({})
    await pushEntriesToBranch('o/r', 'draft', [{ path: 'a.md', content: 'x' }], 'msg')
    for (const call of updateRef.mock.calls) {
      expect(call[0]).not.toHaveProperty('force', true)
    }
  })

  it('gives up and surfaces the error if the race never clears', async () => {
    updateRef.mockRejectedValue(nonFastForward())
    await expect(
      pushEntriesToBranch('o/r', 'draft', [{ path: 'a.md', content: 'x' }], 'msg')
    ).rejects.toThrow(/not a fast forward/i)
  })

  it('does not retry an unrelated failure', async () => {
    updateRef.mockRejectedValue(new Error('Bad credentials'))
    await expect(
      pushEntriesToBranch('o/r', 'draft', [{ path: 'a.md', content: 'x' }], 'msg')
    ).rejects.toThrow(/Bad credentials/)
    expect(updateRef).toHaveBeenCalledTimes(1)
  })
})
