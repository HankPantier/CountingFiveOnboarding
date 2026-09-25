import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'
import { NextResponse } from 'next/server'
import { SID, makeInputRow } from '@/lib/design/__fixtures__/rows'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  createInput: vi.fn(),
  store: vi.fn(),
  remove: vi.fn(),
  sign: vi.fn(async (_s: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`]))),
}))

vi.mock('../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/store', () => ({ createInput: (...a: unknown[]) => m.createInput(...a) }))
vi.mock('@/lib/design/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/design/storage')>()
  return {
    ...actual,
    storeDesignImage: (s: unknown, p: string, w: Buffer) => m.store(s, p, w),
    removeDesignPaths: (s: unknown, p: string[]) => m.remove(s, p),
    signDesignPaths: (s: unknown, p: string[]) => m.sign(s, p),
  }
})

import { POST } from './route'

const params = { params: Promise.resolve({ id: SID }) }
const send = (body: FormData | string, headers?: Record<string, string>) =>
  POST(new Request('http://x/api', { method: 'POST', body, headers }), params)

async function pngFile(): Promise<File> {
  const buf = await sharp({ create: { width: 64, height: 40, channels: 3, background: '#003b71' } }).png().toBuffer()
  return new File([new Uint8Array(buf)], 'shot.png', { type: 'image/png' })
}

// Correct PNG magic bytes, but the rest of the stream is missing — file-type
// identifies it as PNG from the signature alone; sharp then fails to decode.
async function truncatedPngFile(): Promise<File> {
  const buf = await sharp({ create: { width: 64, height: 40, channels: 3, background: '#003b71' } }).png().toBuffer()
  return new File([new Uint8Array(buf.subarray(0, 16))], 'bad.png', { type: 'image/png' })
}

function form(file: File | null, extra: Record<string, string> = {}): FormData {
  const f = new FormData()
  if (file) f.set('file', file)
  for (const [k, v] of Object.entries(extra)) f.set(k, v)
  return f
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  m.gate.mockReset().mockResolvedValue({ sessionId: SID, githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.store.mockReset().mockResolvedValue(undefined)
  m.remove.mockReset().mockResolvedValue(undefined)
  m.createInput.mockReset().mockImplementation(async (_db: unknown, input: { storagePath: string }) =>
    makeInputRow({ kind: 'inspiration_image', url: null, label: null, storage_path: input.storagePath, capture_status: 'ok' })
  )
})

describe('POST /design/inputs/upload', () => {
  it('returns the gate response for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await send(form(await pngFile()))).status).toBe(403)
    expect(m.store).not.toHaveBeenCalled()
  })

  it('rejects a non-multipart body with 400', async () => {
    expect((await send('{"x":1}')).status).toBe(400)
  })

  it('rejects a missing or empty file with 400', async () => {
    expect((await send(form(null))).status).toBe(400)
    expect((await send(form(new File([], 'e.png', { type: 'image/png' })))).status).toBe(400)
  })

  it('rejects an over-long label with 400', async () => {
    expect((await send(form(await pngFile(), { label: 'x'.repeat(121) }))).status).toBe(400)
  })

  it('rejects a file over 8 MB with 413 before storing anything', async () => {
    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
    expect((await send(form(big))).status).toBe(413)
    expect(m.store).not.toHaveBeenCalled()
  })

  it('rejects an oversized Content-Length with 413 before parsing the body', async () => {
    // A body that would 400 (not multipart) if formData() were ever reached —
    // proves the Content-Length check runs and returns first.
    const res = await send('{"x":1}', { 'content-length': String(8 * 1024 * 1024 + 64 * 1024 + 1) })
    expect(res.status).toBe(413)
    expect(m.store).not.toHaveBeenCalled()
  })

  it('rejects a file whose magic bytes are not PNG/JPEG/WebP with 415', async () => {
    const svg = new File([new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')], 'x.png', { type: 'image/png' })
    expect((await send(form(svg))).status).toBe(415)
    expect(m.store).not.toHaveBeenCalled()
  })

  it('rejects a file with correct magic bytes that cannot be decoded with 415', async () => {
    expect((await send(form(await truncatedPngFile()))).status).toBe(415)
    expect(m.store).not.toHaveBeenCalled()
  })

  it('re-encodes to WebP, stores privately and creates the input', async () => {
    const res = await send(form(await pngFile(), { label: 'Moodboard' }))
    expect(res.status).toBe(201)
    const [, storedPath, webp] = m.store.mock.calls[0] as [unknown, string, Buffer]
    expect(storedPath).toMatch(new RegExp(`^design/${SID}/inputs/[0-9a-f-]{36}\\.webp$`))
    expect(webp.subarray(8, 12).toString('ascii')).toBe('WEBP')
    expect(m.createInput).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ sessionId: SID, kind: 'inspiration_image', url: null, label: 'Moodboard', storagePath: storedPath, captureStatus: 'ok', createdBy: 'admin-1' })
    )
    expect((await res.json()).input.thumbnailUrl).toBe(`https://signed/${storedPath}`)
  })

  it('deletes the stored object when the insert fails', async () => {
    m.createInput.mockRejectedValue(new Error('insert failed'))
    const res = await send(form(await pngFile()))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to save the image' })
    expect(m.remove).toHaveBeenCalledWith({}, [m.store.mock.calls[0][1]])
  })

  it('does not roll back a committed upload when signing fails afterward', async () => {
    m.sign.mockRejectedValueOnce(new Error('sign down'))
    const res = await send(form(await pngFile()))
    expect(res.status).toBe(201)
    expect(m.createInput).toHaveBeenCalledTimes(1)
    expect(m.remove).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.input.thumbnailUrl).toBeNull()
  })
})
