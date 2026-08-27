import { beforeEach, describe, expect, it, vi } from 'vitest'

// Shared mock state + fakes for the GitHub repo layer. `vi.hoisted` so the
// vi.mock factory (hoisted above imports) can reference them.
const h = vi.hoisted(() => {
  class FileNotFoundError extends Error {}
  class AssetExistsError extends Error {}
  class StaleShaError extends Error {}
  return {
    // The caller resolveEditContext hands back — a non-owner by default so the
    // config-surface lockdown passes. Individual tests can reassign it.
    ctxUser: {
      id: 'u-1',
      role: 'member',
      isAdmin: false,
      capabilities: ['manager'],
    } as { id: string; role: string; isAdmin: boolean; capabilities: string[] },
    fs: new Map<string, { content: string; sha: string }>(),
    moveCalls: [] as Array<[string, string]>,
    FileNotFoundError,
    AssetExistsError,
    StaleShaError,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    moveFile: vi.fn(),
    ensureDraftBranch: vi.fn(),
  }
})

vi.mock('@/lib/github/repo-files', () => ({
  DRAFT_BRANCH: 'draft',
  FileNotFoundError: h.FileNotFoundError,
  AssetExistsError: h.AssetExistsError,
  StaleShaError: h.StaleShaError,
  ensureDraftBranch: h.ensureDraftBranch,
  readFile: h.readFile,
  writeFile: h.writeFile,
  moveFile: h.moveFile,
}))

vi.mock('../_helpers', () => ({
  resolveEditContext: vi.fn(async () => ({
    adminEmail: 'admin@example.com',
    jobId: 'job-1',
    sessionId: 'sess-1',
    githubRepo: 'repo-1',
    user: h.ctxUser,
  })),
}))

import { POST } from './route'

const NAV = '{"primary":[{"label":"Home","url":"/"}]}'

function req(moves: Array<{ from: string; to: string }>) {
  return new Request('http://test/api/edit/x/nav', {
    method: 'POST',
    body: JSON.stringify({ contents: NAV, moves, expectedSha: 'nav-sha' }),
  })
}
const params = Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' })

function seed(path: string, url: string) {
  h.fs.set(path, { content: `url: ${url}\ntitle: x\n`, sha: `sha-${path}` })
}

beforeEach(() => {
  h.ctxUser = { id: 'u-1', role: 'member', isAdmin: false, capabilities: ['manager'] }
  h.fs.clear()
  h.moveCalls.length = 0
  h.readFile.mockReset()
  h.writeFile.mockReset()
  h.moveFile.mockReset()
  h.ensureDraftBranch.mockReset()

  h.readFile.mockImplementation(async (_repo: string, path: string) => {
    const f = h.fs.get(path)
    if (!f) throw new h.FileNotFoundError(path)
    return { path, content: f.content, sha: f.sha }
  })
  h.writeFile.mockImplementation(async (_repo: string, path: string, content: string) => {
    h.fs.set(path, { content, sha: `sha-${path}` })
    return { commitSha: 'commit', blobSha: `sha-${path}` }
  })
  h.moveFile.mockImplementation(async (_repo: string, from: string, to: string) => {
    h.moveCalls.push([from, to])
    if (h.fs.has(to)) throw new h.AssetExistsError(to)
    const f = h.fs.get(from)
    h.fs.delete(from)
    h.fs.set(to, f ?? { content: '', sha: 'x' })
    return { commitSha: 'commit', blobSha: `sha-${to}` }
  })
})

describe('POST /api/edit/[id]/nav — move validation', () => {
  it('relocates a chain (A→B, B→C) without a false collision, vacating first', async () => {
    seed('content/pages/a.md', '/a')
    seed('content/pages/b.md', '/b')

    const res = await POST(req([
      { from: '/a', to: '/b' },
      { from: '/b', to: '/c' },
    ]), { params })

    expect(res.status).toBe(200)
    // B→C must run before A→B so /b is free when A relocates there.
    expect(h.moveCalls[0]).toEqual(['content/pages/b.md', 'content/pages/c.md'])
    expect(h.moveCalls[1]).toEqual(['content/pages/a.md', 'content/pages/b.md'])
  })

  it('skips a move whose destination is already the same page (no 422, no move)', async () => {
    seed('content/pages/x.md', '/x')
    seed('content/pages/services--x.md', '/services/x') // occupant is already the page

    const res = await POST(req([{ from: '/x', to: '/services/x' }]), { params })

    expect(res.status).toBe(200)
    expect(h.moveFile).not.toHaveBeenCalled()
    const body = (await res.json()) as { moved: number }
    expect(body.moved).toBe(0)
  })

  it('blocks a genuine foreign collision with a named 422', async () => {
    seed('content/pages/x.md', '/x')
    seed('content/pages/services--y.md', '/some-other-page') // unrelated page

    const res = await POST(req([{ from: '/x', to: '/services/y' }]), { params })

    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string; collision: { to: string } }
    expect(body.collision.to).toBe('/services/y')
    expect(h.moveFile).not.toHaveBeenCalled()
  })

  it('denies a Site Owner with 403 — nav is a staff-only config surface', async () => {
    h.ctxUser = { id: 'owner-1', role: 'member', isAdmin: false, capabilities: ['owner'] }
    seed('content/pages/a.md', '/a')

    const res = await POST(req([{ from: '/a', to: '/b' }]), { params })

    expect(res.status).toBe(403)
    expect(h.moveFile).not.toHaveBeenCalled()
    expect(h.writeFile).not.toHaveBeenCalled()
  })

  it('dedupes identical moves', async () => {
    seed('content/pages/a.md', '/a')

    const res = await POST(req([
      { from: '/a', to: '/b' },
      { from: '/a', to: '/b' },
    ]), { params })

    expect(res.status).toBe(200)
    expect(h.moveFile).toHaveBeenCalledTimes(1)
  })

  it('maps a moveFile AssetExistsError to 422', async () => {
    seed('content/pages/a.md', '/a')
    h.moveFile.mockImplementationOnce(async () => {
      throw new h.AssetExistsError('content/pages/b.md')
    })

    const res = await POST(req([{ from: '/a', to: '/b' }]), { params })
    expect(res.status).toBe(422)
  })
})
