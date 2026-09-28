// @vitest-environment jsdom
// Plan Phase 4 (template 2026.09.9): the render gates (overflow / hidden /
// contrast) apply UNCHANGED to a composed doc whose <html> carries a layout
// preset attribute. The doc is built the way the Studio renders it —
// composedThemeFromFiles(design.json with `layout`) → composeThemeDoc — and the
// in-page metrics script runs on it exactly as CDP runs it in the renderer.
import { beforeEach, describe, expect, it } from 'vitest'
import { PAGE_METRICS_SCRIPT } from './page-metrics-script'
import { combineMetrics, evaluatePageSample, metricGateFailures, parseRawPageSample, type RawPageSample } from '../metrics'
import { composeThemeDoc, composedThemeFromFiles } from '../composed-theme'

// A minimal shell: the template's preset rules key off html[data-c5-layout-*]
// (block-layouts.css); the second rule stands in for a bad preset-scoped rule
// that would hide the whole family.
const SHELL = `<!doctype html><html lang="en"><head>
<style>
html[data-c5-layout-cards="list"] [data-block="service-cards"]:not([data-layout]) [data-c5-probe="items"] { display: grid; grid-template-columns: 1fr; }
html[data-c5-layout-faq="split"] [data-block="faq-accordion"] { display: none; }
</style>
<!--__C5_THEME_SLOT__--></head><body>
<section data-block="service-cards" data-rect="0,0,390,600" style="background-color: #ffffff">
  <div data-c5-probe="items" data-rect="0,0,390,600"><h3 data-rect="10,10,300,24" style="color: #111111">Tax planning</h3></div>
</section>
<section data-block="faq-accordion" data-rect="0,600,390,400"><h2 data-rect="10,610,300,30" style="color: #111111">FAQ</h2></section>
</body></html>`

function loadComposed(layout: Record<string, string> | undefined): void {
  const theme = composedThemeFromFiles({ designText: JSON.stringify(layout ? { layout } : {}), themeCss: '', overridesCss: '' })
  const doc = new DOMParser().parseFromString(composeThemeDoc(SHELL, theme), 'text/html')
  const root = document.documentElement
  for (const a of Array.from(root.attributes)) root.removeAttribute(a.name)
  for (const a of Array.from(doc.documentElement.attributes)) root.setAttribute(a.name, a.value)
  document.head.innerHTML = doc.head.innerHTML
  document.body.innerHTML = doc.body.innerHTML
  Object.defineProperty(root, 'clientWidth', { configurable: true, value: 390 })
  Object.defineProperty(root, 'scrollWidth', { configurable: true, value: 390 })
  Object.defineProperty(root, 'scrollHeight', { configurable: true, value: 1000 })
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const [left, top, width, height] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
  }
}

const gates = () => {
  const raw = parseRawPageSample((0, eval)(PAGE_METRICS_SCRIPT)) as RawPageSample
  const metrics = combineMetrics([evaluatePageSample('mobile', raw)])
  if (!metrics) throw new Error('no metrics')
  return metricGateFailures(metrics, null)
}

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('render gates on a composed doc with a layout preset attribute', () => {
  it('the composed <html> carries the preset attribute from design.json layout', () => {
    loadComposed({ cards: 'list' })
    expect(document.documentElement.getAttribute('data-c5-layout-cards')).toBe('list')
    expect(document.documentElement.hasAttribute('data-c5-layout-faq')).toBe(false)
  })
  it('a well-behaved preset (cards: list) passes every gate', () => {
    loadComposed({ cards: 'list' })
    expect(gates()).toEqual([])
  })
  it('a preset-scoped rule that hides a block is still caught by the hidden gate', () => {
    loadComposed({ faq: 'split' })
    const failures = gates()
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ kind: 'hidden' })
    expect(failures[0].message).toContain('faq-accordion')
  })
  it('the same doc without the preset attribute has no failures (the rule never matched)', () => {
    loadComposed(undefined)
    expect(gates()).toEqual([])
  })
})
