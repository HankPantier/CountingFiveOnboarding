import { describe, expect, it } from 'vitest'
import { extractSvgColors, extractSvgColorWeights } from './svg-colors'

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

describe('extractSvgColorWeights', () => {
  it('reports each colour with its occurrence count', () => {
    const svg = `<svg><a fill="#111111"/><b fill="#111111"/><c fill="#222222"/></svg>`
    expect(extractSvgColorWeights(svg)).toEqual([
      { hex: '#111111', weight: 2 },
      { hex: '#222222', weight: 1 },
    ])
  })
})
