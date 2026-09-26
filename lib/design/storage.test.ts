import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import {
  toWebp,
  designStoragePath,
  storeDesignImage,
  signDesignPaths,
  removeDesignPaths,
  downloadDesignImage,
  attachmentStoragePath,
  SCREENSHOT_MAX_EDGE,
} from './storage'

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
  it('rejects an image above the 40M-pixel decode limit', async () => {
    const huge = await png(8000, 6000) // 48M px > 40M limit
    await expect(toWebp(huge)).rejects.toThrow()
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
    ['segment over 200 chars', [SID, 'a'.repeat(201)]],
    ['more than 8 segments', [SID, ...Array.from({ length: 9 }, (_, i) => `seg${i}`)]],
  ])('rejects %s', (_l, args) => {
    const [sid, ...segs] = args as [string, ...string[]]
    expect(() => designStoragePath(sid, ...segs)).toThrow()
  })
  it('allows exactly 8 segments', () => {
    const segs = Array.from({ length: 8 }, (_, i) => `seg${i}`)
    expect(designStoragePath(SID, ...segs)).toBe(`design/${SID}/${segs.join('/')}`)
  })
  it('allows a segment at exactly 200 chars', () => {
    const seg = 'a'.repeat(200)
    expect(designStoragePath(SID, seg)).toBe(`design/${SID}/${seg}`)
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

  it('storeDesignImage passes upsert through (default false)', async () => {
    const calls: unknown[] = []
    const client = { storage: { from: () => ({ upload: async (...a: unknown[]) => { calls.push(a[2]); return { error: null } } }) } } as never
    await storeDesignImage(client, `design/${SID}/runs/x/a.webp`, Buffer.from([1]))
    await storeDesignImage(client, `design/${SID}/runs/x/b.webp`, Buffer.from([1]), { upsert: true })
    expect(calls).toEqual([{ contentType: 'image/webp', upsert: false }, { contentType: 'image/webp', upsert: true }])
  })
})

describe('removeDesignPaths', () => {
  it('removes only design/ paths from the private bucket', async () => {
    const remove = vi.fn(async () => ({ data: [], error: null }))
    const from = vi.fn(() => ({ remove }))
    const supabase = { storage: { from } } as never
    await removeDesignPaths(supabase, [`design/${SID}/inputs/a.webp`, 'sessions/x/secret.pdf', `design/${SID}/../x`])
    expect(from).toHaveBeenCalledWith('session-assets')
    expect(remove).toHaveBeenCalledWith([`design/${SID}/inputs/a.webp`])
  })

  it('is a no-op when nothing is removable', async () => {
    const from = vi.fn()
    await removeDesignPaths({ storage: { from } } as never, ['sessions/x.pdf'])
    expect(from).not.toHaveBeenCalled()
  })

  it('throws when storage reports an error', async () => {
    const supabase = { storage: { from: () => ({ remove: async () => ({ data: null, error: { message: 'boom' } }) }) } } as never
    await expect(removeDesignPaths(supabase, [`design/${SID}/inputs/a.webp`])).rejects.toThrow('removeDesignPaths failed')
  })
})

describe('downloadDesignImage', () => {
  function fakeDb(result: { data: Blob | null; error: { message: string } | null }) {
    const calls: string[] = []
    const db = {
      storage: {
        from: (bucket: string) => ({
          download: async (p: string) => {
            calls.push(`${bucket}:${p}`)
            return result
          },
        }),
      },
    }
    return { calls, db: db as never }
  }

  it('returns the bytes of a design/ object from the private bucket', async () => {
    const f = fakeDb({ data: new Blob([new Uint8Array([7, 8, 9])]), error: null })
    const bytes = await downloadDesignImage(f.db, `design/${SID}/inputs/a.webp`)
    expect(Array.from(bytes)).toEqual([7, 8, 9])
    expect(f.calls).toEqual([`session-assets:design/${SID}/inputs/a.webp`])
  })

  it.each(['sessions/x/a.png', `design/${SID}/../../pdfs/a.pdf`])('refuses %s without calling storage', async (p) => {
    const f = fakeDb({ data: null, error: null })
    await expect(downloadDesignImage(f.db, p)).rejects.toThrow('not a design path')
    expect(f.calls).toEqual([])
  })

  it('throws on a storage error', async () => {
    const f = fakeDb({ data: null, error: { message: 'not found' } })
    await expect(downloadDesignImage(f.db, `design/${SID}/inputs/a.webp`)).rejects.toThrow('downloadDesignImage failed')
  })
})

describe('attachmentStoragePath', () => {
  it('builds design/{sid}/attachments/{uuid}.webp and refuses anything but a uuid', () => {
    const sid = '7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184'
    expect(attachmentStoragePath(sid, '0B6F1C2E-5D4A-4E8B-9C1D-2F3A4B5C6D7E')).toBe(`design/${sid}/attachments/0b6f1c2e-5d4a-4e8b-9c1d-2f3a4b5c6d7e.webp`)
    expect(() => attachmentStoragePath(sid, '../x')).toThrow()
  })
})
