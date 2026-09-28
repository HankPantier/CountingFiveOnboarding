import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { applyLogoNavDefault, applyLogoTone, LIGHT_LOGO_NOTE, preflightLogo, trimLogoPlate } from './logo-preflight'

// A w×h PNG: `bg` (RGBA) everywhere with a centred bw×bh box of `fg`.
async function png(
  w: number,
  h: number,
  bg: { r: number; g: number; b: number; alpha: number },
  fg: { r: number; g: number; b: number },
  bw: number,
  bh: number,
): Promise<Buffer> {
  const box = await sharp({ create: { width: bw, height: bh, channels: 4, background: { ...fg, alpha: 1 } } }).png().toBuffer()
  return sharp({ create: { width: w, height: h, channels: 4, background: bg } })
    .composite([{ input: box, left: Math.floor((w - bw) / 2), top: Math.floor((h - bh) / 2) }])
    .png()
    .toBuffer()
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }
const NAVY = { r: 18, g: 40, b: 76 }

describe('preflightLogo', () => {
  it('trims heavy transparent padding (Accord rendered 81px wide)', async () => {
    const logo = await png(400, 200, TRANSPARENT, NAVY, 300, 60)
    const r = await preflightLogo(logo, 'logo.png')
    expect(r.trimmed).toEqual({ from: '400×200', to: '300×60' })
    const meta = await sharp(r.buffer).metadata()
    expect([meta.width, meta.height, meta.format]).toEqual([300, 60, 'png'])
    expect(r.notes[0]).toMatch(/trimmed from 400×200 to 300×60/)
  })

  it('leaves a tightly cropped logo byte-identical', async () => {
    const logo = await png(300, 64, TRANSPARENT, NAVY, 296, 60)
    const r = await preflightLogo(logo, 'logo.png')
    expect(r.trimmed).toBeNull()
    expect(r.buffer).toBe(logo)
    expect(r.notes).toEqual([])
  })

  it('flags a white logo (Berg) so the first deploy uses the inverted nav', async () => {
    const logo = await png(300, 64, TRANSPARENT, { r: 255, g: 255, b: 255 }, 296, 60)
    const r = await preflightLogo(logo, 'logo.png')
    expect(r.lightLogo).toBe(true)
    expect(r.notes).toContain(LIGHT_LOGO_NOTE)
  })

  it('reports an opaque white background box (Pryor, Buss)', async () => {
    const logo = await png(400, 120, { r: 255, g: 255, b: 255, alpha: 1 }, NAVY, 200, 40)
    const r = await preflightLogo(logo, 'logo.png')
    expect(r.plate?.hex).toBe('#ffffff')
    expect(r.lightLogo).toBe(false)
    expect(r.notes.some((n) => /opaque #ffffff background box/.test(n))).toBe(true)
  })

  it('analyses SVG colours without rasterising or rewriting the file', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#ffffff"/><path fill="#ffffff"/><path fill="#fdec55"/></svg>')
    const r = await preflightLogo(svg, 'wordmark.svg')
    expect(r.buffer).toBe(svg)
    expect(r.lightLogo).toBe(true)
  })

  it('marks the tone conclusive only when pixels / SVG colours were actually read', async () => {
    expect((await preflightLogo(await png(300, 64, TRANSPARENT, NAVY, 296, 60), 'logo.png')).toneConclusive).toBe(true)
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#12284c"/></svg>')
    expect((await preflightLogo(svg, 'logo.svg')).toneConclusive).toBe(true)
    const gif = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).gif().toBuffer()
    expect(await preflightLogo(gif, 'logo.gif')).toMatchObject({ lightLogo: false, toneConclusive: false })
    // sharp throws on bytes it can't decode.
    expect(await preflightLogo(Buffer.from('not an image'), 'logo.png')).toMatchObject({ lightLogo: false, toneConclusive: false })
  })

  it('light logo → design.json style.nav=inverted, unless a nav style is already chosen', () => {
    expect(applyLogoNavDefault({ roundness: 'soft' } as { roundness: string; style?: Record<string, string> }, true).style).toEqual({ nav: 'inverted' })
    expect(applyLogoNavDefault({ style: { cards: 'flat' } }, true).style).toEqual({ cards: 'flat', nav: 'inverted' })
    expect(applyLogoNavDefault({ style: { nav: 'bordered' } }, true).style).toEqual({ nav: 'bordered' })
    expect(applyLogoNavDefault({} as { style?: Record<string, string> }, false).style).toBeUndefined()
  })

  it('light logo → brand.json logo.tone "light"; a dark logo gets no key (template R1)', () => {
    expect(applyLogoTone({ primary: 'l.png', alt: 'a' } as { primary: string; alt: string; tone?: 'light' | 'dark' }, true)).toEqual({
      primary: 'l.png',
      alt: 'a',
      tone: 'light',
    })
    expect(applyLogoTone({ primary: 'l.png', alt: 'a' } as { primary: string; alt: string; tone?: 'light' | 'dark' }, false)).toEqual({
      primary: 'l.png',
      alt: 'a',
    })
  })

  it('wires a real white logo end-to-end into the nav default', async () => {
    const logo = await png(300, 64, TRANSPARENT, { r: 255, g: 255, b: 255 }, 296, 60)
    const design: { style?: Record<string, string> } = {}
    applyLogoNavDefault(design, (await preflightLogo(logo, 'logo.png')).lightLogo)
    expect(design.style?.nav).toBe('inverted')
  })

  it('never throws on an undecodable file', async () => {
    const junk = Buffer.from('not an image')
    const r = await preflightLogo(junk, 'logo.png')
    expect(r.buffer).toBe(junk)
    expect(r.notes).toEqual([])
  })
})

describe('trimLogoPlate', () => {
  const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }

  it('crops an opaque white plate to the ink plus a margin (Pryor)', async () => {
    const logo = await png(600, 200, WHITE, NAVY, 400, 50)
    const r = await trimLogoPlate(logo)
    // ink 400×50, margin round(50 × 0.08) = 4 on every side
    expect(r?.trimmed).toEqual({ from: '600×200', to: '408×58' })
    expect(r?.plateHex).toBe('#ffffff')
    const meta = await sharp(r!.buffer).metadata()
    expect([meta.width, meta.height, meta.format]).toEqual([408, 58, 'png'])
  })

  it('ignores faint near-plate pixels (scan borders) under the threshold', async () => {
    const base = await png(600, 200, WHITE, NAVY, 400, 50)
    const frame = await sharp({ create: { width: 600, height: 2, channels: 4, background: { r: 240, g: 240, b: 240, alpha: 1 } } }).png().toBuffer()
    const logo = await sharp(base).composite([{ input: frame, left: 0, top: 198 }]).png().toBuffer()
    expect((await trimLogoPlate(logo))?.trimmed.to).toBe('408×58')
  })

  it('leaves transparent, dark-plate and barely padded logos alone', async () => {
    expect(await trimLogoPlate(await png(400, 200, TRANSPARENT, NAVY, 300, 60))).toBeNull()
    expect(await trimLogoPlate(await png(400, 200, { ...NAVY, alpha: 1 }, WHITE, 300, 60))).toBeNull()
    expect(await trimLogoPlate(await png(400, 100, WHITE, NAVY, 390, 96))).toBeNull()
  })

  it('never throws on garbage', async () => {
    expect(await trimLogoPlate(Buffer.from('not an image'))).toBeNull()
  })
})
