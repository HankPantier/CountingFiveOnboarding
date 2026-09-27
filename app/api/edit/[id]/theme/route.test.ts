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
vi.mock('@/lib/editor/theme-edit', async (orig) => ({
  ...((await orig()) as object),
  patchBrandPalette: vi.fn(),
  patchDesignTypography: vi.fn(),
  patchDesignFlags: vi.fn((text: string) => ({
    ok: true,
    changed: true,
    design: { ...JSON.parse(text), headlineStyle: 'serif' },
    next: JSON.stringify({ ...JSON.parse(text), headlineStyle: 'serif' }),
  })),
}))
vi.mock('@/lib/content/theme-css-generator', async (orig) => ({
  ...((await orig()) as object),
  generateThemeCss: vi.fn(() => ':root{}'),
  checkThemeContrast: vi.fn(() => []),
  checkActionContrast: vi.fn(() => []),
}))
vi.mock('@/lib/design/sync-mbp-theme', () => ({ syncMbpTheme: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(() => ({})) }))
vi.mock('@/lib/design/theme-sources', () => ({ loadDraftThemeSources: vi.fn() }))

import { PATCH } from './route'
import { patchDesignTypography } from '@/lib/editor/theme-edit'
import { generateFontsModule } from '@/lib/content/font-module-generator'
import { normalizeTypography } from './_theme'
import { checkActionContrast } from '@/lib/content/theme-css-generator'
import { syncMbpTheme } from '@/lib/design/sync-mbp-theme'

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

  it('failing action pairs (advisory) still save; they come back as warnings with their fix hints', async () => {
    vi.mocked(checkActionContrast).mockReturnValueOnce([
      { name: 'action (large text) / primary', ratio: 2.46, minRatio: 3, bg: '#003a42', fg: '#cc381e', hint: 'a darker primary reads better' },
      { name: 'action (large text) / background', ratio: 2.29, minRatio: 3, bg: '#ffffff', fg: '#ff8e27', hint: 'a darker action colour reads better' },
    ])
    const res = await patchFlags()
    expect(res.status).toBe(200)
    expect(h.writeFiles).toHaveBeenCalledTimes(1)
    expect((await res.json()).contrastWarnings).toEqual([
      'action (large text) / primary: 2.46:1 (need 3:1) — a darker primary reads better',
      'action (large text) / background: 2.29:1 (need 3:1) — a darker action colour reads better',
    ])
  })

  it('maps a concurrent change to 409', async () => {
    h.writeFiles.mockRejectedValueOnce(new h.StaleShaError('src/styles/theme.css'))
    const res = await patchFlags()
    expect(res.status).toBe(409)
  })
})

describe('PATCH /api/edit/[id]/theme — fonts module (L2+ drafts)', () => {
  const FONTS = 'src/app/fonts.generated.ts'
  const E40 = 'e'.repeat(40)
  const patchTypography = () =>
    PATCH(
      new Request('http://test/theme', { method: 'PATCH', body: JSON.stringify({ typography: { headingFont: 'Inter' } }) }),
      { params }
    )

  beforeEach(() => {
    vi.mocked(patchDesignTypography).mockImplementation((text: string, t: Record<string, string>) => {
      const design = JSON.parse(text) as { typography: Record<string, string> }
      const next = { ...design, typography: { ...design.typography, ...t } }
      return { ok: true, changed: true, design: next, next: JSON.stringify(next) } as unknown as ReturnType<typeof patchDesignTypography>
    })
  })

  it('Controls writes the fonts module on an L2 draft', async () => {
    h.fs.set('c5-template.json', { content: '{"capabilities":["fonts"]}', sha: 'markerSha' })
    h.fs.set(FONTS, { content: 'old', sha: E40 })
    const res = await patchTypography()
    expect(res.status).toBe(200)
    const files = h.writeFiles.mock.calls[0][1] as { path: string; content: string; expectedSha?: string | null }[]
    expect(files.find((f) => f.path === FONTS)).toEqual({
      path: FONTS,
      content: generateFontsModule(normalizeTypography({ headingFont: 'Inter' })).source,
      expectedSha: E40,
    })
  })

  it('an absent module on an L2 draft is written as must-not-exist (null)', async () => {
    h.fs.set('c5-template.json', { content: '{"capabilities":["fonts"]}', sha: 'markerSha' })
    await patchFlags()
    const files = h.writeFiles.mock.calls[0][1] as { path: string; expectedSha?: string | null }[]
    expect(files.find((f) => f.path === FONTS)?.expectedSha).toBeNull()
  })

  it('…and not on an L1 draft', async () => {
    h.fs.set(FONTS, { content: 'old', sha: E40 })
    await patchTypography()
    const files = h.writeFiles.mock.calls[0][1] as { path: string }[]
    expect(files.map((f) => f.path)).not.toContain(FONTS)
  })
})

describe('PATCH /api/edit/[id]/theme — regenerate (stale-notice button)', () => {
  const FONTS = 'src/app/fonts.generated.ts'
  const regenerate = () =>
    PATCH(new Request('http://test/theme', { method: 'PATCH', body: JSON.stringify({ regenerate: true }) }), { params })

  it('rewrites theme.css from the unchanged brand/design (both locked, contents untouched) and skips the MBP sync', async () => {
    h.fs.set('src/styles/theme.css', { content: 'house cyan', sha: 'themeSha' })
    vi.mocked(syncMbpTheme).mockClear()
    const res = await regenerate()
    expect(res.status).toBe(200)
    expect(h.writeFiles).toHaveBeenCalledTimes(1)
    const [, files, , message] = h.writeFiles.mock.calls[0] as [string, { path: string; content: string; expectedSha?: string | null }[], string, string]
    expect(files.find((f) => f.path === 'src/styles/theme.css')).toEqual({ path: 'src/styles/theme.css', content: ':root{}', expectedSha: 'themeSha' })
    expect(files.find((f) => f.path === 'content/brand.json')).toEqual({ path: 'content/brand.json', content: '{"palette":{}}', expectedSha: 'brandSha' })
    expect(files.find((f) => f.path === 'content/design.json')).toEqual({ path: 'content/design.json', content: '{"typography":{}}', expectedSha: 'designSha' })
    expect(message).toMatch(/^Theme: regenerate theme files/)
    expect(syncMbpTheme).not.toHaveBeenCalled()
  })

  it('regenerates the fonts module on an L2 draft', async () => {
    h.fs.set('c5-template.json', { content: '{"capabilities":["fonts"]}', sha: 'markerSha' })
    h.fs.set('src/styles/theme.css', { content: ':root{}', sha: 'themeSha' })
    h.fs.set(FONTS, { content: 'default seed', sha: 'f'.repeat(40) })
    const res = await regenerate()
    expect(res.status).toBe(200)
    const files = h.writeFiles.mock.calls[0][1] as { path: string; content: string }[]
    expect(files.find((f) => f.path === FONTS)?.content).toBe(generateFontsModule(normalizeTypography({})).source)
  })

  it('refuses (409 fallbackPalette) to regenerate a FALLBACK-palette site until the operator confirms', async () => {
    const fallback = { primary: '#1F3A5F', secondary: '#5A6B7B', complementary: '#C2703D', action: '#0E8C9C', nearBlack: '#1A1C1E', nearWhite: '#F8F8F6' }
    h.fs.set('content/brand.json', { content: JSON.stringify({ palette: fallback }), sha: 'brandSha' })
    h.fs.set('src/styles/theme.css', { content: 'house cyan', sha: 'themeSha' })
    const refused = await regenerate()
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ fallbackPalette: true })
    expect(h.writeFiles).not.toHaveBeenCalled()
    const ok = await PATCH(
      new Request('http://test/theme', { method: 'PATCH', body: JSON.stringify({ regenerate: true, allowFallbackPalette: true }) }),
      { params }
    )
    expect(ok.status).toBe(200)
    expect(h.writeFiles).toHaveBeenCalledTimes(1)
  })

  it('on an L1 draft says the fonts module was not touched', async () => {
    h.fs.set('src/styles/theme.css', { content: 'old', sha: 'themeSha' })
    const res = await regenerate()
    expect((await res.json()).note).toMatch(/fonts module was not touched/)
    const files = h.writeFiles.mock.calls[0][1] as { path: string }[]
    expect(files.map((f) => f.path)).not.toContain(FONTS)
  })

  it('is a no-op (no empty commit) when the derived files already match', async () => {
    h.fs.set('src/styles/theme.css', { content: ':root{}', sha: 'themeSha' })
    const res = await regenerate()
    expect(res.status).toBe(200)
    expect((await res.json()).note).toMatch(/already match/)
    expect(h.writeFiles).not.toHaveBeenCalled()
  })
})
