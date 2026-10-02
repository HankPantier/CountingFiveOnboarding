import { describe, expect, it } from 'vitest'
import { LOGO_MAX_BYTES, validateLogoUpload } from './logo-upload'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

describe('validateLogoUpload', () => {
  it('accepts a PNG by magic bytes, unchanged', async () => {
    const r = await validateLogoUpload(PNG)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.logo).toMatchObject({ mime: 'image/png', ext: 'png', rewritten: false })
    expect(r.logo.buffer.equals(PNG)).toBe(true)
  })

  it('sanitizes an SVG and strips scripts', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect fill="#f00"/></svg>')
    const r = await validateLogoUpload(svg)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.logo).toMatchObject({ mime: 'image/svg+xml', ext: 'svg', rewritten: true })
    expect(r.logo.buffer.toString('utf-8').toLowerCase()).not.toContain('<script')
  })

  it('rejects a non-image file with magic bytes (e.g. a renamed executable or PDF)', async () => {
    const r = await validateLogoUpload(Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n'))
    expect(r).toMatchObject({ ok: false, status: 415 })
    const exe = await validateLogoUpload(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]))
    expect(exe).toMatchObject({ ok: false, status: 415 })
  })

  it('rejects plain text and GIF', async () => {
    expect(await validateLogoUpload(Buffer.from('hello'))).toMatchObject({ ok: false, status: 415 })
    expect(await validateLogoUpload(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'binary'))).toMatchObject({ ok: false, status: 415 })
  })

  it('rejects empty and oversized files', async () => {
    expect(await validateLogoUpload(Buffer.alloc(0))).toMatchObject({ ok: false, status: 413 })
    expect(await validateLogoUpload(Buffer.alloc(LOGO_MAX_BYTES + 1))).toMatchObject({ ok: false, status: 413 })
  })
})
