import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  plan: null as null | { companion: { path: string; content: string; expectedSha: string }; notice: string },
  planRedirectClear: vi.fn(),
  moveFile: vi.fn(async (..._args: unknown[]) => ({ commitSha: 'c' })),
  stripNavReference: vi.fn(),
}))

vi.mock('../_helpers', () => ({
  resolveEditContext: async () => ({ githubRepo: 'repo', adminEmail: 'a@x.com', adminName: 'A' }),
}))
vi.mock('@/lib/editor/nav-mutations', () => ({ stripNavReference: h.stripNavReference }))
vi.mock('@/lib/editor/relocate', () => ({ readSiteBlogPath: async () => '/insights' }))
vi.mock('@/lib/editor/new-page-redirects', () => ({ planRedirectClear: h.planRedirectClear }))
vi.mock('@/lib/github/repo-files', () => ({
  AssetExistsError: class extends Error {},
  FileNotFoundError: class extends Error {},
  StaleShaError: class extends Error {},
  DRAFT_BRANCH: 'draft',
  deleteFile: vi.fn(),
  ensureDraftBranch: vi.fn(),
  moveFile: h.moveFile,
}))

import { POST } from './route'

function call(body: unknown) {
  return POST(new Request('http://x/api/edit/s/page', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 's' }),
  })
}

describe('POST /api/edit/[id]/page — restore vs. a shadowing redirect', () => {
  beforeEach(() => {
    h.moveFile.mockClear()
    h.planRedirectClear.mockReset()
    h.planRedirectClear.mockImplementation(async () => h.plan)
  })

  it('removes the redirect in the same commit as the restore and returns a notice', async () => {
    h.plan = {
      companion: { path: 'content/redirects.csv', content: 'old_url,new_url,status_code,reason\n', expectedSha: 'r' },
      notice: 'Removed the redirect /about → / from redirects.csv so the new page is reachable.',
    }
    const res = await call({ path: 'content/drafts/pages/about.md', expectedSha: 'sha', action: 'restore' })
    expect(res.status).toBe(200)
    expect(h.planRedirectClear).toHaveBeenCalledWith('repo', ['/about'])
    const opts = h.moveFile.mock.calls[0]![6] as { companions?: unknown[] }
    expect(opts.companions).toEqual([h.plan.companion])
    const data = (await res.json()) as { newPath: string; redirectNotice?: string }
    expect(data.newPath).toBe('content/pages/about.md')
    expect(data.redirectNotice).toMatch(/\/about → \//)
  })

  it('uses the site blog path for a restored post', async () => {
    h.plan = null
    await call({ path: 'content/drafts/posts/tax-tips.md', expectedSha: 'sha', action: 'restore' })
    expect(h.planRedirectClear).toHaveBeenCalledWith('repo', ['/insights/tax-tips'])
    const opts = h.moveFile.mock.calls[0]![6] as { companions?: unknown[] }
    expect(opts.companions).toBeUndefined()
  })

  it('never touches redirects when drafting a page', async () => {
    await call({ path: 'content/pages/about.md', expectedSha: 'sha', action: 'draft' })
    expect(h.planRedirectClear).not.toHaveBeenCalled()
  })
})
