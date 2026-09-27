import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  StaleShaError: class StaleShaError extends Error {},
  ensureDraftBranch: vi.fn(),
  listTree: vi.fn(),
  writeFile: vi.fn(),
  reviewContentEdit: vi.fn(),
}))

vi.mock('@/lib/github/repo-files', () => ({
  DRAFT_BRANCH: 'draft',
  StaleShaError: h.StaleShaError,
  ensureDraftBranch: h.ensureDraftBranch,
  listTree: h.listTree,
  writeFile: h.writeFile,
}))

vi.mock('@/lib/content/content-edit-review', () => ({ reviewContentEdit: h.reviewContentEdit }))

vi.mock('../_helpers', () => ({
  resolveEditContext: vi.fn(async () => ({
    adminEmail: 'admin@example.com',
    sessionId: 'sess-1',
    githubRepo: 'repo-1',
    user: { id: 'u-1', role: 'admin', isAdmin: true, capabilities: [] },
  })),
}))

import { PATCH } from './route'

const HEADER = 'old_url,new_url,status_code,reason\n'
const params = { params: Promise.resolve({ id: 'sess-1' }) }

function patch(contents: string) {
  return PATCH(
    new Request('http://x/api/edit/sess-1/files', {
      method: 'PATCH',
      body: JSON.stringify({ path: 'content/redirects.csv', contents, expectedSha: 's1' }),
    }),
    params
  )
}

describe('PATCH /api/edit/[id]/files — redirects.csv guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.listTree.mockResolvedValue([
      { path: 'content/pages/services--outsourced-accounting.md', sha: 'a', type: 'blob' },
      { path: 'content/pages/about.md', sha: 'b', type: 'blob' },
    ])
    h.writeFile.mockResolvedValue({ commitSha: 'c', blobSha: 'b2' })
  })

  it('blocks a redirect loop with a 422 and writes nothing', async () => {
    const res = await patch(`${HEADER}/a,/b,301,x\n/b,/a,301,x\n`)
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/redirect loop \/a → \/b → \/a/)
    expect(h.writeFile).not.toHaveBeenCalled()
  })

  it('blocks redirecting a path that has a real page', async () => {
    const res = await patch(`${HEADER}/services/outsourced-accounting,/services,301,x\n`)
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/has a real page/)
  })

  it('still blocks loops when the page tree is unavailable', async () => {
    h.listTree.mockRejectedValue(new Error('rate limited'))
    const res = await patch(`${HEADER}/a,/a/,301,x\n`)
    expect(res.status).toBe(422)
  })

  it('commits a clean redirects file', async () => {
    const res = await patch(`${HEADER}/old,/about,301,x\n`)
    expect(res.status).toBe(200)
    expect(h.writeFile).toHaveBeenCalledOnce()
  })
})
