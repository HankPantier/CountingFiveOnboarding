import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import { toWebp, designStoragePath, storeDesignImage, signDesignPaths, SCREENSHOT_MAX_EDGE } from './storage'

const SID = '7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184'

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#003b71' } }).png().toBuffer()
}

describe('toWebp', () => {
  it('re-encodes to WebP and caps the long edge at 1568', async () => {
    const r = await toWebp(await png(2880, 1800))
    expect(r.webp.subarray(8, 12).toString('ascii')).toBe('WEBP')
    expect(Math.max(r.width, r.height)).toBe(SCREENSHOT_MAX_EDGE)
    expect(r.width / r.height).toBeCloseTo(1.6, 1)
  })
  it('never upscales', async () => {
    const r = await toWebp(await png(390, 844))
    expect([r.width, r.height]).toEqual([390, 844])
  })
})

describe('designStoragePath', () => {
  it('builds a design/{session}/... path', () => {
    expect(designStoragePath(SID, 'renders', 'abc-desktop-0.webp')).toBe(`design/${SID}/renders/abc-desktop-0.webp`)
  })
  it.each([
    ['bad session id', ['not-a-uuid', 'x.webp']],
    ['traversal segment', [SID, '..', 'x.webp']],
    ['slash inside a segment', [SID, 'a/b.webp']],
    ['empty segment', [SID, '', 'x.webp']],
    ['leading dot', [SID, '.hidden']],
  ])('rejects %s', (_l, args) => {
    const [sid, ...segs] = args as [string, ...string[]]
    expect(() => designStoragePath(sid, ...segs)).toThrow()
  })
})

describe('storage wrappers', () => {
  it('uploads WebP without upsert and signs for one hour', async () => {
    const upload = vi.fn(async () => ({ data: {}, error: null }))
    const createSignedUrls = vi.fn(async (paths: string[]) => ({
      data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}`, error: null })),
      error: null,
    }))
    const from = vi.fn(() => ({ upload, createSignedUrls }))
    const supabase = { storage: { from } } as never
    await storeDesignImage(supabase, `design/${SID}/renders/a.webp`, Buffer.from('x'))
    expect(from).toHaveBeenCalledWith('session-assets')
    expect(upload).toHaveBeenCalledWith(`design/${SID}/renders/a.webp`, expect.any(Buffer), { contentType: 'image/webp', upsert: false })
    const signed = await signDesignPaths(supabase, [`design/${SID}/renders/a.webp`])
    expect(createSignedUrls).toHaveBeenCalledWith([`design/${SID}/renders/a.webp`], 3600)
    expect(signed[`design/${SID}/renders/a.webp`]).toBe(`https://signed/design/${SID}/renders/a.webp`)
  })

  it('throws when the upload fails', async () => {
    const supabase = { storage: { from: () => ({ upload: async () => ({ data: null, error: { message: 'boom' } }) }) } } as never
    await expect(storeDesignImage(supabase, `design/${SID}/x.webp`, Buffer.from('x'))).rejects.toThrow()
  })
})
