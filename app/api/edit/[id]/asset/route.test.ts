import { beforeEach, describe, expect, it, vi } from 'vitest'

type Companion = { path: string; content: string; expectedSha: string | null }
type CompanionOpts = { mode: string; expectedSha?: string; companions: Companion[] }

const h = vi.hoisted(() => ({
  brandText: '' as string | null,
  lightLogo: false,
  writeBinaryFile: vi.fn(async (..._args: unknown[]) => ({ commitSha: 'c1', blobSha: 'b1' })),
  writeBinaryFileWithCompanions: vi.fn(async (..._args: unknown[]) => ({ commitSha: 'c2', blobSha: 'b2' })),
}))

vi.mock('../_helpers', () => ({
  resolveEditContext: async () => ({ githubRepo: 'repo', adminEmail: 'a@x.com', adminName: 'A' }),
}))
vi.mock('@/lib/content/logo-preflight', () => ({
  preflightLogo: async (buffer: Buffer) => ({ buffer, lightLogo: h.lightLogo, trimmed: null, plate: null, notes: [] }),
}))
vi.mock('@/lib/github/repo-files', () => {
  class FileNotFoundError extends Error {}
  return {
    AssetExistsError: class extends Error {},
    StaleShaError: class extends Error {},
    FileNotFoundError,
    DRAFT_BRANCH: 'draft',
    deleteFile: vi.fn(),
    ensureDraftBranch: vi.fn(),
    readBinaryFile: vi.fn(),
    readBlobBySha: vi.fn(),
    readFile: vi.fn(async (_slug: string, path: string) => {
      if (h.brandText === null) throw new FileNotFoundError(path)
      return { path, content: h.brandText, sha: 'brand-sha' }
    }),
    writeBinaryFile: h.writeBinaryFile,
    writeBinaryFileWithCompanions: h.writeBinaryFileWithCompanions,
  }
})

import { PUT } from './route'

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

function put(path: string) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), 'x.png')
  form.append('path', path)
  form.append('mode', 'replace')
  form.append('expectedSha', 'old-sha')
  return PUT(new Request('http://x/api/edit/s/asset', { method: 'PUT', body: form }), {
    params: Promise.resolve({ id: 's' }),
  })
}

const brand = (logo: Record<string, unknown>) => JSON.stringify({ firm: { name: 'A' }, logo }, null, 2) + '\n'
const companionOpts = () => h.writeBinaryFileWithCompanions.mock.calls[0]![5] as CompanionOpts

describe('PUT /api/edit/[id]/asset — logo tone re-derivation', () => {
  beforeEach(() => {
    h.writeBinaryFile.mockClear()
    h.writeBinaryFileWithCompanions.mockClear()
    h.lightLogo = false
  })

  it('clears a stale light tone in the same commit when the logo is replaced with a dark one', async () => {
    h.brandText = brand({ primary: 'logo.png', alt: 'A logo', tone: 'light' })
    const res = await put('public/content-assets/logo.png')
    expect(res.status).toBe(200)
    expect(h.writeBinaryFile).not.toHaveBeenCalled()
    expect(h.writeBinaryFileWithCompanions).toHaveBeenCalledTimes(1)
    const opts = companionOpts()
    expect(opts.mode).toBe('replace')
    expect(opts.expectedSha).toBe('old-sha')
    expect(opts.companions).toHaveLength(1)
    expect(opts.companions[0]!.path).toBe('content/brand.json')
    expect(opts.companions[0]!.expectedSha).toBe('brand-sha')
    expect(JSON.parse(opts.companions[0]!.content).logo.tone).toBeUndefined()
    const data = (await res.json()) as { blobSha: string; logoTone?: string }
    expect(data.blobSha).toBe('b2')
    expect(data.logoTone).toMatch(/cleared/)
  })

  it('sets tone "light" when a light logo replaces a dark one', async () => {
    h.brandText = brand({ primary: 'logo.png', alt: 'A logo' })
    h.lightLogo = true
    const res = await put('public/content-assets/logo.png')
    expect(res.status).toBe(200)
    expect(JSON.parse(companionOpts().companions[0]!.content).logo.tone).toBe('light')
  })

  it('commits the image alone when the tone is already right', async () => {
    h.brandText = brand({ primary: 'logo.png', alt: 'A logo' })
    const res = await put('public/content-assets/logo.png')
    expect(res.status).toBe(200)
    expect(h.writeBinaryFileWithCompanions).not.toHaveBeenCalled()
    expect(h.writeBinaryFile).toHaveBeenCalledTimes(1)
    expect(((await res.json()) as { logoTone?: string }).logoTone).toBeUndefined()
  })

  it('leaves brand.json alone for a non-logo image', async () => {
    h.brandText = brand({ primary: 'logo.png', alt: 'A logo', tone: 'light' })
    await put('public/content-assets/hero.png')
    expect(h.writeBinaryFileWithCompanions).not.toHaveBeenCalled()
    expect(h.writeBinaryFile).toHaveBeenCalledTimes(1)
  })

  it('still uploads when the site has no brand.json', async () => {
    h.brandText = null
    const res = await put('public/content-assets/logo.png')
    expect(res.status).toBe(200)
    expect(h.writeBinaryFile).toHaveBeenCalledTimes(1)
  })
})
