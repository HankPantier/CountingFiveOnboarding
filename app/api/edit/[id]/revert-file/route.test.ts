import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  ctx: { githubRepo: 'repo-1', adminName: 'A', adminEmail: 'a@x', user: { id: 'u', isAdmin: false } },
  revertFileToMain: vi.fn(),
}))

vi.mock('../_helpers', () => ({ resolveEditContext: vi.fn(async () => h.ctx) }))
vi.mock('@/lib/github/repo-files', () => ({
  StaleShaError: class StaleShaError extends Error {},
  revertFileToMain: (...a: unknown[]) => h.revertFileToMain(...a),
}))

import { POST } from './route'

const params = Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' })
const call = (body: unknown) =>
  POST(
    new Request('http://test/revert-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params }
  )

beforeEach(() => {
  h.ctx.user.isAdmin = false
  h.revertFileToMain.mockReset().mockResolvedValue({ reverted: true, commitSha: 'c', action: 'restored' })
})

describe('POST /api/edit/[id]/revert-file — lockdown', () => {
  it.each([
    'content/design.json',
    'content/brand.json',
    'content/client-center.json',
    'content/redirects.csv',
    'content/design-overrides.css',
    'content/nav.json',
  ])('403s a non-admin (editor / Site Owner) reverting %s', async (path) => {
    const res = await call({ path, expectedSha: 's' })
    expect(res.status).toBe(403)
    expect(h.revertFileToMain).not.toHaveBeenCalled()
  })

  it('lets a non-admin revert page markdown and media', async () => {
    expect((await call({ path: 'content/pages/about.md', expectedSha: 's' })).status).toBe(200)
    expect((await call({ path: 'public/content-assets/a.png', expectedSha: 's' })).status).toBe(200)
  })

  it('lets an admin revert site config but never nav.json', async () => {
    h.ctx.user.isAdmin = true
    expect((await call({ path: 'content/design.json', expectedSha: 's' })).status).toBe(200)
    expect((await call({ path: 'content/nav.json', expectedSha: 's' })).status).toBe(403)
  })

  it('applies the lockdown to a rename previousPath too', async () => {
    const res = await call({ path: 'content/pages/x.md', expectedSha: 's', previousPath: 'content/brand.json' })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/edit/[id]/revert-file — renames', () => {
  it('passes the validated previousPath so both sides revert together', async () => {
    const res = await call({
      path: 'content/drafts/pages/x.md',
      expectedSha: 'newSha',
      previousPath: 'content/pages/x.md',
    })
    expect(res.status).toBe(200)
    expect(h.revertFileToMain).toHaveBeenCalledWith(
      'repo-1',
      'content/drafts/pages/x.md',
      'newSha',
      expect.any(Object),
      'content/pages/x.md'
    )
  })

  it('rejects a traversal previousPath (decoded before validation)', async () => {
    const res = await call({ path: 'content/pages/x.md', expectedSha: 's', previousPath: 'content/..%2F..%2Fetc/passwd' })
    expect(res.status).toBe(400)
    expect(h.revertFileToMain).not.toHaveBeenCalled()
  })
})
