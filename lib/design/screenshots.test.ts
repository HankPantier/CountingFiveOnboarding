import { describe, it, expect } from 'vitest'
import { fontsNotReadyNote, fontsNotReadyViewports, parseScreenshots } from './screenshots'

const shot = (viewport: string, extra: Record<string, unknown> = {}) => ({ viewport, path: `design/s/runs/r/c-${viewport}.webp`, width: 10, height: 10, ...extra })

describe('parseScreenshots — fontsReady flag', () => {
  it('keeps fontsReady: false; drops any other value (absent = fonts were ready)', () => {
    const out = parseScreenshots([shot('desktop', { fontsReady: false }), shot('mobile', { fontsReady: true }), shot('desktop', { fontsReady: 'no' })])
    expect(out[0]).toEqual({ viewport: 'desktop', path: 'design/s/runs/r/c-desktop.webp', width: 10, height: 10, fontsReady: false })
    expect('fontsReady' in out[1]).toBe(false)
    expect('fontsReady' in out[2]).toBe(false)
  })
})

describe('fontsNotReadyNote', () => {
  it('null when every fold had its fonts', () => {
    expect(fontsNotReadyNote(parseScreenshots([shot('desktop'), shot('mobile')]))).toBeNull()
    expect(fontsNotReadyNote([])).toBeNull()
  })
  it('names the one viewport, or both', () => {
    const one = parseScreenshots([shot('desktop', { fontsReady: false }), shot('mobile')])
    expect(fontsNotReadyViewports(one)).toEqual(['desktop'])
    expect(fontsNotReadyNote(one)).toBe('Fonts hadn’t finished loading when this was captured — the desktop screenshot may show fallback fonts.')
    const both = parseScreenshots([shot('desktop', { fontsReady: false }), shot('mobile', { fontsReady: false })])
    expect(fontsNotReadyNote(both)).toBe('Fonts hadn’t finished loading when this was captured — the screenshots may show fallback fonts.')
  })
})
