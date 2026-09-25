// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { PAGE_METRICS_SCRIPT } from './page-metrics-script'
import { evaluatePageSample, parseRawPageSample, type RawPageSample } from '../metrics'

function stubLayout(viewportWidth: number, scrollWidth: number): void {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: viewportWidth })
  Object.defineProperty(document.documentElement, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 2000 })
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
  }
}

// Indirect eval runs the script in the (jsdom) global scope, like CDP does in the page.
const collect = () => parseRawPageSample((0, eval)(PAGE_METRICS_SCRIPT))

beforeEach(() => {
  document.body.innerHTML = `
    <section data-block="hero" data-rect="0,0,390,400" style="background-color: #ffffff">
      <p data-rect="10,10,200,20" style="color: #bbbbbb">Faint body copy</p>
      <p data-rect="10,40,200,20" style="color: #111111">Readable copy</p>
      <p style="color: #111111">No box</p>
    </section>
    <section data-block="feature-grid" style="display: none"><p>Gone</p></section>
    <section data-block="cta-banner" data-rect="0,400,390,100">
      <div data-rect="0,410,600,20">Too wide</div>
    </section>`
  stubLayout(390, 420)
})

describe('PAGE_METRICS_SCRIPT', () => {
  it('is a self-contained expression (no template interpolation, no imports)', () => {
    expect(PAGE_METRICS_SCRIPT.trim().startsWith('(() =>')).toBe(true)
    expect(PAGE_METRICS_SCRIPT).not.toContain('${')
    expect(PAGE_METRICS_SCRIPT).not.toMatch(/\bimport\b|\brequire\(/)
  })
  it('returns the viewport, the document width and one raw sample per visible text element', () => {
    const s = collect()
    expect(s).not.toBeNull()
    expect(s?.viewportWidth).toBe(390)
    expect(s?.scrollWidth).toBe(420)
    const faint = s?.text.find((x) => x.text === 'Faint body copy')
    expect(faint?.key).toBe('block:hero p#0')
    expect(faint?.color).toContain('187')
    expect(faint?.bg[0]).toContain('255')
    expect(s?.text.map((x) => x.text)).not.toContain('No box') // zero-size ⇒ not visible
  })
  it('reports every [data-block] with its display / geometry', () => {
    const s = collect()
    expect(s?.blocks.map((b) => b.key)).toEqual(['block:hero#0', 'block:feature-grid#0', 'block:cta-banner#0'])
    expect(s?.blocks[1].display).toBe('none')
  })
  it('names the outermost element that pokes past the right edge', () => {
    expect(collect()?.offenders).toEqual(['block:cta-banner div#0 (600px)'])
  })
  it.each([
    ['html overflow-x: hidden', 'html', 'overflow-x: hidden'],
    ['html overflow-x: clip', 'html', 'overflow-x: clip'],
    ['body overflow-x: hidden (propagates to the viewport)', 'body', 'overflow-x: hidden'],
    ['body overflow: hidden shorthand', 'body', 'overflow: hidden'],
  ])('a root/body horizontal clip (%s) is not page overflow and has no offenders', (_label, target, css) => {
    const el = target === 'html' ? document.documentElement : document.body
    el.setAttribute('style', css)
    try {
      const s = collect()
      expect(s?.scrollWidth).toBe(390)
      expect(s?.offenders).toEqual([])
      expect(evaluatePageSample('mobile', s as RawPageSample).overflow).toBeNull()
    } finally {
      el.removeAttribute('style')
    }
  })
  it('still flags overflow when only an inner element clips something else', () => {
    document.body.insertAdjacentHTML('beforeend', '<div data-rect="0,600,390,50" style="overflow-x: hidden"><span data-rect="0,600,700,20">clipped</span></div>')
    const s = collect()
    expect(s?.scrollWidth).toBe(420)
    expect(s?.offenders).toEqual(['block:cta-banner div#0 (600px)'])
    expect(evaluatePageSample('mobile', s as RawPageSample).overflow).not.toBeNull()
  })
})
