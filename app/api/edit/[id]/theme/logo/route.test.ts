import { beforeEach, describe, expect, it, vi } from 'vitest'

type Companion = { path: string; content: string; expectedSha: string | null }
type CompanionOpts = { mode: string; companions: Companion[] }

const SHA = 'a'.repeat(40)

const h = vi.hoisted(() => ({
  brandText: '' as string | null,
  brandSha: '',
  isAdmin: true,
  lightLogo: false,
  conclusive: true,
  assetExists: false,
  stale: false,
  writeBinaryFileWithCompanions: vi.fn(),
  writeFiles: vi.fn(async (..._args: unknown[]) => ({ commitSha: 'c', blobs: {} })),
  replaceSessionLogoRow: vi.fn(async (..._args: unknown[]) => ({ ok: true, assetId: 'asset-1' })),
  storageUpload: vi.fn(async (..._args: unknown[]) => ({ error: null as unknown })),
  storeDesignImage: vi.fn(async (..._args: unknown[]) => {}),
}))

vi.mock('../../_helpers', () => ({
  resolveEditContext: async () => ({
    githubRepo: 'repo',
    sessionId: 'sess-1',
    adminEmail: 'a@x.com',
    adminName: 'A',
    user: { isAdmin: h.isAdmin, capabilities: h.isAdmin ? [] : ['manager'] },
  }),
}))
vi.mock('@/lib/content/logo-preflight', () => ({
  LIGHT_LOGO_NOTE: 'LIGHT NOTE',
  preflightLogo: async (buffer: Buffer) => ({
    buffer,
    lightLogo: h.lightLogo,
    toneConclusive: h.conclusive,
    trimmed: null,
    plate: null,
    notes: [],
  }),
}))
vi.mock('@/lib/assets/replace-session-logo', () => ({ replaceSessionLogoRow: h.replaceSessionLogoRow }))
vi.mock('@/lib/design/storage', () => ({
  toWebp: async (b: Buffer) => ({ webp: b, width: 10, height: 4 }),
  attachmentStoragePath: (sid: string, id: string) => `design/${sid}/attachments/${id}.webp`,
  storeDesignImage: h.storeDesignImage,
  signDesignPaths: async (_s: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    storage: { from: () => ({ upload: h.storageUpload, remove: vi.fn(async () => ({})) }) },
  }),
}))
vi.mock('@/lib/github/repo-files', () => {
  class FileNotFoundError extends Error {}
  class AssetExistsError extends Error {}
  class StaleShaError extends Error {}
  h.writeBinaryFileWithCompanions.mockImplementation(async () => {
    if (h.stale) throw new StaleShaError('brand')
    if (h.assetExists) throw new AssetExistsError('exists')
    return { commitSha: 'c', blobSha: 'b' }
  })
  return {
    AssetExistsError,
    StaleShaError,
    FileNotFoundError,
    DRAFT_BRANCH: 'draft',
    ensureDraftBranch: vi.fn(),
    readFile: vi.fn(async (_slug: string, path: string) => {
      if (h.brandText === null) throw new FileNotFoundError(path)
      return { path, content: h.brandText, sha: h.brandSha }
    }),
    writeBinaryFileWithCompanions: h.writeBinaryFileWithCompanions,
    writeFiles: h.writeFiles,
  }
})

import { DELETE, POST } from './route'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const params = { params: Promise.resolve({ id: 'sess-1' }) }
const brand = (logo: Record<string, unknown>) => JSON.stringify({ firm: { name: 'A' }, logo }, null, 2) + '\n'

function post(slot: string, bytes: Buffer = PNG, sha: string | null = SHA, attach = false) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)]), 'upload.png')
  form.append('slot', slot)
  if (sha !== null) form.append('brandSha', sha)
  if (attach) form.append('attach', '1')
  return POST(new Request('http://x/api/edit/sess-1/theme/logo', { method: 'POST', body: form }), params)
}
const committedBrand = () => {
  const opts = h.writeBinaryFileWithCompanions.mock.calls[0]![5] as CompanionOpts
  expect(opts.mode).toBe('create')
  expect(opts.companions[0]!.path).toBe('content/brand.json')
  expect(opts.companions[0]!.expectedSha).toBe(SHA)
  return JSON.parse(opts.companions[0]!.content) as { logo: Record<string, unknown> }
}

describe('/api/edit/[id]/theme/logo', () => {
  beforeEach(() => {
    h.brandText = brand({ primary: 'old.png', alt: 'A logo', tone: 'light' })
    h.brandSha = SHA
    h.isAdmin = true
    h.lightLogo = false
    h.conclusive = true
    h.assetExists = false
    h.stale = false
    h.writeBinaryFileWithCompanions.mockClear()
    h.writeFiles.mockClear()
    h.replaceSessionLogoRow.mockClear()
    h.storageUpload.mockClear()
  })

  it('403s a non-admin', async () => {
    h.isAdmin = false
    expect((await post('primary')).status).toBe(403)
    expect(h.writeBinaryFileWithCompanions).not.toHaveBeenCalled()
  })

  it('a primary upload commits a content-hashed file + brand.json, clears a stale light tone, and replaces the onboarding logo', async () => {
    const res = await post('primary')
    expect(res.status).toBe(200)
    const [, path, bytes] = h.writeBinaryFileWithCompanions.mock.calls[0]! as [string, string, Buffer]
    expect(path).toMatch(/^public\/content-assets\/logo-[0-9a-f]{10}\.png$/)
    expect(bytes.equals(PNG)).toBe(true)
    const logo = committedBrand().logo
    expect(logo.primary).toBe(path.replace('public/content-assets/', ''))
    expect(logo.tone).toBeUndefined()
    expect(logo.alt).toBe('A logo')
    expect(h.storageUpload).toHaveBeenCalledTimes(1)
    expect(h.storageUpload.mock.calls[0]![0]).toMatch(/^sessions\/sess-1\/[0-9a-f-]{36}-logo-[0-9a-f]{10}\.png$/)
    expect(h.replaceSessionLogoRow).toHaveBeenCalledTimes(1)
    expect(((await res.json()) as { warning?: string }).warning).toBeUndefined()
  })

  it('a light primary logo sets tone "light" and returns the light-logo note', async () => {
    h.brandText = brand({ primary: 'old.png', alt: 'A logo' })
    h.lightLogo = true
    const res = await post('primary')
    expect(committedBrand().logo.tone).toBe('light')
    expect(((await res.json()) as { notices: string[] }).notices).toContain('LIGHT NOTE')
  })

  it('a footer upload sets logo.footer only and never touches the onboarding asset', async () => {
    const res = await post('footer')
    expect(res.status).toBe(200)
    const logo = committedBrand().logo
    expect(logo.footer).toMatch(/^logo-footer-[0-9a-f]{10}\.png$/)
    expect(logo.primary).toBe('old.png')
    expect(logo.tone).toBe('light')
    expect(h.storageUpload).not.toHaveBeenCalled()
    expect(h.replaceSessionLogoRow).not.toHaveBeenCalled()
  })

  it('409s when brand.json moved since the client read it', async () => {
    h.brandSha = 'b'.repeat(40)
    expect((await post('primary')).status).toBe(409)
    expect(h.writeBinaryFileWithCompanions).not.toHaveBeenCalled()
    h.brandSha = SHA
    h.stale = true
    expect((await post('primary')).status).toBe(409)
  })

  it('rejects an unsupported file before any write', async () => {
    const res = await post('primary', Buffer.from('%PDF-1.4\n1 0 obj'))
    expect(res.status).toBe(415)
    expect(h.writeBinaryFileWithCompanions).not.toHaveBeenCalled()
  })

  it('rejects a bad slot or a malformed sha', async () => {
    expect((await post('favicon')).status).toBe(400)
    expect((await post('primary', PNG, 'nope')).status).toBe(400)
  })

  it('re-uploading identical bytes only repoints brand.json', async () => {
    h.assetExists = true
    const res = await post('primary')
    expect(res.status).toBe(200)
    expect(h.writeFiles).toHaveBeenCalledTimes(1)
    const files = h.writeFiles.mock.calls[0]![1] as Companion[]
    expect(files[0]!.path).toBe('content/brand.json')
    expect(files[0]!.expectedSha).toBe(SHA)
  })

  it('reports (does not fail) an onboarding-copy sync failure', async () => {
    h.replaceSessionLogoRow.mockResolvedValueOnce({ ok: false, error: new Error('db') } as never)
    const res = await post('primary')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { warning?: string }).warning).toMatch(/onboarding copy/)
  })

  it('from the chat: no brandSha (guarded by the sha read in the request) and the logo comes back as a chat attachment', async () => {
    h.storeDesignImage.mockClear()
    const res = await post('primary', PNG, null, true)
    expect(res.status).toBe(200)
    expect(committedBrand().logo.primary).toMatch(/^logo-[0-9a-f]{10}\.png$/)
    const data = (await res.json()) as { attachment?: { id: string; url: string | null } }
    expect(data.attachment?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(data.attachment?.url).toBe(`https://signed/design/sess-1/attachments/${data.attachment?.id}.webp`)
    expect(h.storeDesignImage).toHaveBeenCalledTimes(1)
  })

  it('no attachment unless asked for', async () => {
    h.storeDesignImage.mockClear()
    const data = (await (await post('primary')).json()) as { attachment?: unknown }
    expect(data.attachment).toBeUndefined()
    expect(h.storeDesignImage).not.toHaveBeenCalled()
  })

  it('DELETE removes only logo.footer', async () => {
    h.brandText = brand({ primary: 'a.png', alt: 'A logo', footer: 'f.png' })
    const res = await DELETE(new Request(`http://x/api/edit/sess-1/theme/logo?slot=footer&brandSha=${SHA}`, { method: 'DELETE' }), params)
    expect(res.status).toBe(200)
    const files = h.writeFiles.mock.calls[0]![1] as Companion[]
    expect(JSON.parse(files[0]!.content).logo).toEqual({ primary: 'a.png', alt: 'A logo' })
    const bad = await DELETE(new Request(`http://x/api/edit/sess-1/theme/logo?slot=primary&brandSha=${SHA}`, { method: 'DELETE' }), params)
    expect(bad.status).toBe(400)
  })
})
