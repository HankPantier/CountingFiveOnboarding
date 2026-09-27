import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  relocateFile: vi.fn(),
  stripNavReference: vi.fn(),
}))

vi.mock('../_helpers', () => ({
  resolveEditContext: async () => ({ githubRepo: 'repo', user: { isAdmin: true, capabilities: [] } }),
}))
vi.mock('@/lib/auth/access', () => ({ isSiteOwner: () => false }))
vi.mock('@/lib/editor/relocate', () => ({
  DestinationOccupiedError: class extends Error {},
  relocateFile: h.relocateFile,
}))
vi.mock('@/lib/editor/nav-mutations', () => ({
  appendNavItem: vi.fn(),
  retargetNavUrl: vi.fn(),
  stripNavReference: h.stripNavReference,
}))
vi.mock('@/lib/github/repo-files', () => ({
  DRAFT_BRANCH: 'draft',
  StaleShaError: class extends Error {},
  ensureDraftBranch: vi.fn(),
  listTree: vi.fn(async () => []),
}))

import { POST } from './route'

function call(body: unknown) {
  return POST(new Request('http://x/api/edit/s/move', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 's' }),
  })
}

describe('POST /api/edit/[id]/move — refused trailer strip', () => {
  const body = { fromPath: 'content/pages/a.md', toUrl: '/resources/a', expectedSha: 'sha', navAction: 'remove' }

  it('passes relocateFile’s warning through to the client', async () => {
    h.relocateFile.mockResolvedValueOnce({ blobSha: 'b', moved: true, warning: 'Generator notes found but not removed' })
    const res = await call(body)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { warning?: string; moved: boolean }
    expect(data.moved).toBe(true)
    expect(data.warning).toBe('Generator notes found but not removed')
  })

  it('omits warning on a clean move', async () => {
    h.relocateFile.mockResolvedValueOnce({ blobSha: 'b', moved: true })
    const data = (await (await call(body)).json()) as Record<string, unknown>
    expect('warning' in data).toBe(false)
  })
})
