import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'
import { NextResponse } from 'next/server'
import { SID } from '@/lib/design/__fixtures__/rows'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  store: vi.fn(),
  sign: vi.fn(async (_s: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`]))),
}))
vi.mock('../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/storage', async (orig) => ({
  ...((await orig()) as object),
  storeDesignImage: (s: unknown, p: string, w: Buffer) => m.store(s, p, w),
  signDesignPaths: (s: unknown, p: string[]) => m.sign(s, p),
}))

import { POST } from './route'

const send = (body: FormData) => POST(new Request('http://x/api', { method: 'POST', body }), { params: Promise.resolve({ id: SID }) })
const form = async () => {
  const f = new FormData()
  f.set('file', new File([new Uint8Array(await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#003b71' } }).png().toBuffer())], 'a.png', { type: 'image/png' }))
  return f
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  m.gate.mockReset().mockResolvedValue({ sessionId: SID, adminId: 'admin-1', user: { isAdmin: true } })
  m.store.mockReset().mockResolvedValue(undefined)
})

describe('POST /design/attachments', () => {
  it('passes the gate response through', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await send(await form())).status).toBe(403)
  })
  it('stores a re-encoded WebP (long edge ≤ 1568) under attachments/{uuid}.webp and returns its signed url', async () => {
    const res = await send(await form())
    expect(res.status).toBe(201)
    const { attachment } = (await res.json()) as { attachment: { id: string; url: string; width: number; height: number } }
    expect(attachment.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(attachment).toMatchObject({ width: 1568, height: 523 })
    const [, path, webp] = m.store.mock.calls[0] as [unknown, string, Buffer]
    expect(path).toBe(`design/${SID}/attachments/${attachment.id}.webp`)
    expect(webp.subarray(8, 12).toString('ascii')).toBe('WEBP')
    expect(attachment.url).toBe(`https://signed/${path}`)
  })
  it('415s a non-image and never stores it', async () => {
    const f = new FormData()
    f.set('file', new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }))
    expect((await send(f)).status).toBe(415)
    expect(m.store).not.toHaveBeenCalled()
  })
  it('returns 201 with a null url when signing fails', async () => {
    m.sign.mockRejectedValueOnce(new Error('sign down'))
    const res = await send(await form())
    expect(res.status).toBe(201)
    expect(((await res.json()) as { attachment: { url: unknown } }).attachment.url).toBeNull()
  })
  it('hides a storage failure behind a 500', async () => {
    m.store.mockRejectedValue(new Error('bucket secret'))
    const res = await send(await form())
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('bucket')
  })
})
