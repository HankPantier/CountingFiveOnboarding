import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class FileNotFoundError extends Error {}
  class StaleShaError extends Error {
    constructor(public path: string) {
      super(`stale ${path}`)
    }
  }
  return {
    FileNotFoundError,
    StaleShaError,
    fs: new Map<string, { content: string; sha: string }>(),
    writeFiles: vi.fn(),
  }
})

vi.mock('../_helpers', () => ({
  resolveEditContext: vi.fn(async () => ({
    githubRepo: 'repo',
    sessionId: 's',
    jobId: 'j',
    adminEmail: 'a@x',
    user: { id: 'u', isAdmin: true },
  })),
}))
vi.mock('@/lib/github/repo-files', () => ({
  DRAFT_BRANCH: 'draft',
  FileNotFoundError: h.FileNotFoundError,
  StaleShaError: h.StaleShaError,
  ensureDraftBranch: vi.fn(),
  readFile: vi.fn(async (_repo: string, path: string) => {
    const f = h.fs.get(path)
    if (!f) throw new h.FileNotFoundError(path)
    return { path, ...f }
  }),
  writeFiles: (...a: unknown[]) => h.writeFiles(...a),
}))
vi.mock('@/lib/editor/theme-edit', () => ({
  patchBrandPalette: vi.fn(),
  patchDesignTypography: vi.fn(),
  patchDesignFlags: vi.fn((text: string) => ({
    ok: true,
    changed: true,
    design: { ...JSON.parse(text), headlineStyle: 'serif' },
    next: JSON.stringify({ ...JSON.parse(text), headlineStyle: 'serif' }),
  })),
}))
vi.mock('@/lib/content/theme-css-generator', () => ({
  generateThemeCss: vi.fn(() => ':root{}'),
  checkThemeContrast: vi.fn(() => []),
}))
vi.mock('@/lib/design/sync-mbp-theme', () => ({ syncMbpTheme: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(() => ({})) }))
vi.mock('@/lib/design/theme-sources', () => ({ loadDraftThemeSources: vi.fn() }))

import { PATCH } from './route'

const params = Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' })
const patchFlags = () =>
  PATCH(
    new Request('http://test/theme', { method: 'PATCH', body: JSON.stringify({ flags: { headlineStyle: 'serif' } }) }),
    { params }
  )

beforeEach(() => {
  h.fs.clear()
  h.fs.set('content/brand.json', { content: '{"palette":{}}', sha: 'brandSha' })
  h.fs.set('content/design.json', { content: '{"typography":{}}', sha: 'designSha' })
  h.writeFiles.mockReset().mockResolvedValue({ commitSha: 'c', blobs: {} })
})

describe('PATCH /api/edit/[id]/theme — optimistic locks', () => {
  it('guards an absent theme.css as must-not-exist (never an unguarded create)', async () => {
    const res = await patchFlags()
    expect(res.status).toBe(200)
    const files = h.writeFiles.mock.calls[0][1] as { path: string; expectedSha?: string | null }[]
    expect(files.find((f) => f.path === 'src/styles/theme.css')?.expectedSha).toBeNull()
  })

  it('locks the unchanged brand.json too (theme.css depends on both), writing it unchanged', async () => {
    h.fs.set('src/styles/theme.css', { content: 'old', sha: 'themeSha' })
    await patchFlags()
    const files = h.writeFiles.mock.calls[0][1] as { path: string; content: string; expectedSha?: string | null }[]
    const brand = files.find((f) => f.path === 'content/brand.json')
    expect(brand).toEqual({ path: 'content/brand.json', content: '{"palette":{}}', expectedSha: 'brandSha' })
    expect(files.find((f) => f.path === 'content/design.json')?.expectedSha).toBe('designSha')
    expect(files.find((f) => f.path === 'src/styles/theme.css')?.expectedSha).toBe('themeSha')
  })

  it('maps a concurrent change to 409', async () => {
    h.writeFiles.mockRejectedValueOnce(new h.StaleShaError('src/styles/theme.css'))
    const res = await patchFlags()
    expect(res.status).toBe(409)
  })
})
