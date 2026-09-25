import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { MAX_IMAGE_UPLOAD_BYTES, readImageForm, toValidatedWebp } from './upload-image'

const req = (body: FormData | string, headers?: Record<string, string>) => new Request('http://x/api', { method: 'POST', body, headers })
const png = async () => new Blob([new Uint8Array(await sharp({ create: { width: 80, height: 50, channels: 3, background: '#003b71' } }).png().toBuffer())], { type: 'image/png' })

describe('readImageForm', () => {
  it('rejects a non-multipart body, a missing file, an empty file, an oversized file and an oversized Content-Length', async () => {
    expect(await readImageForm(req('nope'))).toMatchObject({ ok: false, status: 400 })
    expect(await readImageForm(req(new FormData()))).toMatchObject({ ok: false, status: 400, error: 'An image file is required.' })
    const empty = new FormData()
    empty.set('file', new Blob([]))
    expect(await readImageForm(req(empty))).toMatchObject({ ok: false, status: 400, error: 'The file is empty.' })
    const big = new FormData()
    big.set('file', new Blob([new Uint8Array(MAX_IMAGE_UPLOAD_BYTES + 1)]))
    expect(await readImageForm(req(big))).toMatchObject({ ok: false, status: 413 })
    expect(await readImageForm(req(new FormData(), { 'content-length': String(10 * 1024 * 1024) }))).toMatchObject({ ok: false, status: 413 })
  })
  it('returns the form and the file', async () => {
    const f = new FormData()
    f.set('file', await png())
    f.set('label', 'x')
    const r = await readImageForm(req(f))
    expect(r.ok && r.form.get('label')).toBe('x')
  })
})

describe('toValidatedWebp', () => {
  it('re-encodes a real image to WebP and reports its size', async () => {
    const r = await toValidatedWebp(await png())
    expect(r).toMatchObject({ ok: true, width: 80, height: 50 })
    expect(r.ok && r.webp.subarray(8, 12).toString('ascii')).toBe('WEBP')
  })
  it('415s wrong magic bytes and undecodable images', async () => {
    expect(await toValidatedWebp(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>']))).toMatchObject({ ok: false, status: 415, error: 'Upload a PNG, JPEG or WebP image.' })
    const buf = await sharp({ create: { width: 64, height: 40, channels: 3, background: '#003b71' } }).png().toBuffer()
    expect(await toValidatedWebp(new Blob([new Uint8Array(buf.subarray(0, 16))]))).toMatchObject({ ok: false, status: 415, error: 'That image could not be read.' })
  })
})
