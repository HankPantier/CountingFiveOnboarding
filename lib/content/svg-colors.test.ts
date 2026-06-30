import { describe, expect, it } from 'vitest'
import { extractSvgColors, pickBrandColors } from './svg-colors'

describe('extractSvgColors', () => {
  it('pulls fill/stroke/stop-color in attribute and style forms, normalized to hex', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="#FF0000" stroke="#00ff00"/>
      <circle style="fill:#0000FF;stroke: red"/>
      <stop stop-color="rgb(255,255,0)"/>
    </svg>`
    const colors = extractSvgColors(svg)
    expect(colors).toContain('#ff0000')
    expect(colors).toContain('#00ff00')
    expect(colors).toContain('#0000ff')
    expect(colors).toContain('#ffff00')
    expect(colors).toContain('#ff0000') // 'red' named → #ff0000
  })

  it('skips none/currentColor/url() and invalid tokens', () => {
    const svg = `<svg><path fill="none" stroke="currentColor"/><path fill="url(#grad)"/></svg>`
    expect(extractSvgColors(svg)).toEqual([])
  })

  it('ranks by frequency', () => {
    const svg = `<svg><a fill="#111111"/><b fill="#111111"/><c fill="#222222"/></svg>`
    expect(extractSvgColors(svg)[0]).toBe('#111111')
  })
})

describe('pickBrandColors', () => {
  it('picks a saturated primary and a hue-distinct secondary', () => {
    const picked = pickBrandColors(['#ff0000', '#0000ff', '#000000', '#ffffff'])
    expect(picked).not.toBeNull()
    expect(picked!.primary).toBe('#ff0000')
    expect(picked!.secondary).toBe('#0000ff')
  })

  it('returns null when nothing usable', () => {
    expect(pickBrandColors([])).toBeNull()
  })

  it('falls back to neutrals only when no saturated color exists', () => {
    const picked = pickBrandColors(['#000000', '#ffffff'])
    expect(picked).not.toBeNull()
    expect(picked!.primary).toBe('#000000')
  })
})
