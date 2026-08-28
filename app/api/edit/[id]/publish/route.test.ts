import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibrarySelectionStatus } from '@/lib/content/library-inclusion'

const h = vi.hoisted(() => ({
  ctx: { jobId: 'job-1', sessionId: 'sess-1', githubRepo: 'repo-1', user: { id: 'u' } },
  libraryStatus: {
    total: 0,
    pending: 0,
    drafting: 0,
    complete: 0,
    error: 0,
    terminal: true,
  } as LibrarySelectionStatus,
  canPublish: true,
  imageCoverage: { ok: true, missing: [] as string[] },
  mergeDraftToMain: vi.fn(),
  resetDraftToMain: vi.fn(),
  ensureDraftBranch: vi.fn(),
}))

vi.mock('../_helpers', () => ({ resolveEditContext: vi.fn(async () => h.ctx) }))
vi.mock('@/lib/auth/access', () => ({
  getCurrentUser: vi.fn(async () => h.ctx.user),
  canPublish: vi.fn(() => h.canPublish),
}))
vi.mock('@/lib/content/library-inclusion', () => ({
  getLibrarySelectionStatus: vi.fn(async () => h.libraryStatus),
}))
vi.mock('@/lib/content/repull-images', () => ({
  getDraftImageCoverage: vi.fn(async () => h.imageCoverage),
}))
vi.mock('@/lib/github/repo-files', () => ({
  ensureDraftBranch: h.ensureDraftBranch,
  mergeDraftToMain: (...a: unknown[]) => h.mergeDraftToMain(...a),
  resetDraftToMain: h.resetDraftToMain,
}))

import { POST } from './route'

const params = Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' })
const call = () => POST(new Request('http://test/publish', { method: 'POST' }), { params })

beforeEach(() => {
  h.libraryStatus = { total: 0, pending: 0, drafting: 0, complete: 0, error: 0, terminal: true }
  h.canPublish = true
  h.imageCoverage = { ok: true, missing: [] }
  h.mergeDraftToMain.mockReset().mockResolvedValue({ merged: true })
  h.resetDraftToMain.mockReset()
  h.ensureDraftBranch.mockReset()
})

describe('POST /api/edit/[id]/publish — included-library gate', () => {
  it('blocks with 409 (no merge) while library selections are still pending/drafting', async () => {
    h.libraryStatus = { total: 3, pending: 2, drafting: 1, complete: 0, error: 0, terminal: false }
    const res = await call()
    expect(res.status).toBe(409)
    const body = (await res.json()) as { libraryPending?: boolean }
    expect(body.libraryPending).toBe(true)
    expect(h.mergeDraftToMain).not.toHaveBeenCalled()
  })

  it('allows publish when selections are terminal (complete/error) or none exist', async () => {
    h.libraryStatus = { total: 2, pending: 0, drafting: 0, complete: 1, error: 1, terminal: true }
    const res = await call()
    expect(res.status).toBe(200)
    expect(h.mergeDraftToMain).toHaveBeenCalledOnce()
  })

  it('blocks with 409 (no merge) when the draft still references unresolved images', async () => {
    h.imageCoverage = { ok: false, missing: ['hero-x.jpg', 'inline-y.jpg'] }
    const res = await call()
    expect(res.status).toBe(409)
    const body = (await res.json()) as { imagesMissing?: boolean; missing?: string[] }
    expect(body.imagesMissing).toBe(true)
    expect(body.missing).toHaveLength(2)
    expect(h.mergeDraftToMain).not.toHaveBeenCalled()
  })

  it('rejects a non-publisher with 403 before the library check runs', async () => {
    h.canPublish = false
    // Even with pending library work, the 403 short-circuits first.
    h.libraryStatus = { total: 1, pending: 1, drafting: 0, complete: 0, error: 0, terminal: false }
    const res = await call()
    expect(res.status).toBe(403)
    expect(h.mergeDraftToMain).not.toHaveBeenCalled()
  })
})
