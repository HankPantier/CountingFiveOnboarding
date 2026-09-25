import { describe, it, expect } from 'vitest'
import {
  AA_LARGE,
  AA_NORMAL,
  MAX_CONTRAST_FAILURES,
  combineMetrics,
  contrastOf,
  describeKey,
  evaluatePageSample,
  metricGateFailures,
  parseRawPageSample,
  parseRenderMetrics,
  type RawBlockSample,
  type RawPageSample,
  type RawTextSample,
  type RenderMetrics,
} from './metrics'

const t = (over: Partial<RawTextSample> = {}): RawTextSample => ({
  key: 'block:hero p#0',
  text: 'Hello there',
  color: 'rgb(119, 119, 119)',
  bg: ['rgb(255, 255, 255)'],
  bgImage: false,
  fontSizePx: 16,
  fontWeight: 400,
  opacity: 1,
  ...over,
})
const block = (over: Partial<RawBlockSample> = {}): RawBlockSample => ({
  key: 'block:hero#0',
  display: 'block',
  visibility: 'visible',
  opacity: 1,
  width: 390,
  height: 600,
  left: 0,
  right: 390,
  top: 0,
  bottom: 600,
  ...over,
})
const page = (over: Partial<RawPageSample> = {}): RawPageSample => ({
  viewportWidth: 390,
  scrollWidth: 390,
  docHeight: 3000,
  offenders: [],
  text: [],
  blocks: [],
  ...over,
})

describe('contrastOf', () => {
  it('#777 on white is ~4.48:1 — below AA for body text', () => {
    const c = contrastOf(t())
    expect(c?.required).toBe(AA_NORMAL)
    expect(c?.ratio).toBeCloseTo(4.48, 2)
  })
  it('large text (≥ 24 px, or ≥ 18.66 px bold) needs 3:1', () => {
    expect(contrastOf(t({ fontSizePx: 24 }))?.required).toBe(AA_LARGE)
    expect(contrastOf(t({ fontSizePx: 19, fontWeight: 700 }))?.required).toBe(AA_LARGE)
    expect(contrastOf(t({ fontSizePx: 19, fontWeight: 600 }))?.required).toBe(AA_NORMAL)
  })
  it('composites translucent backgrounds innermost-over-outermost onto a white canvas', () => {
    // 50% black over white ≈ #808080; white text on it ≈ 3.95:1.
    const c = contrastOf(t({ color: 'rgb(255, 255, 255)', bg: ['rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)'] }))
    expect(c?.ratio).toBeCloseTo(3.95, 1)
    // No opaque ancestor at all ⇒ the white canvas.
    expect(contrastOf(t({ bg: [] }))?.ratio).toBeCloseTo(4.48, 2)
  })
  it('applies the effective opacity to the text colour', () => {
    const solid = contrastOf(t({ color: 'rgb(0, 0, 0)' }))?.ratio ?? 0
    const faded = contrastOf(t({ color: 'rgb(0, 0, 0)', opacity: 0.3 }))?.ratio ?? 0
    expect(faded).toBeLessThan(solid)
    expect(faded).toBeLessThan(AA_NORMAL)
  })
  it('reads oklch() and treats transparent / empty backgrounds as see-through', () => {
    expect(contrastOf(t({ color: 'oklch(0.2 0 0)', bg: ['transparent', '', 'rgb(255, 255, 255)'] }))?.ratio).toBeGreaterThan(AA_NORMAL)
  })
  it('is unverifiable over a background image or with an unparseable colour', () => {
    expect(contrastOf(t({ bgImage: true }))).toBeNull()
    expect(contrastOf(t({ color: 'color(srgb 1 0 0)' }))).toBeNull()
    expect(contrastOf(t({ color: '' }))).toBeNull()
  })
})

describe('evaluatePageSample', () => {
  it('lists AA failures worst-first with floored ratios and counts unverifiable text', () => {
    const vm = evaluatePageSample(
      'mobile',
      page({
        text: [
          t({ key: 'block:hero p#0', text: 'Faint', color: 'rgb(187, 187, 187)' }),
          t({ key: 'block:hero p#1', text: 'Nearly', color: 'rgb(119, 119, 119)' }),
          t({ key: 'block:hero p#2', text: 'Fine', color: 'rgb(17, 17, 17)' }),
          t({ key: 'block:hero p#3', text: 'Photo', bgImage: true }),
        ],
      })
    )
    expect(vm.textChecked).toBe(3)
    expect(vm.textUnverified).toBe(1)
    expect(vm.contrast.map((f) => f.text)).toEqual(['Faint', 'Nearly'])
    expect(vm.contrast[1].ratio).toBe(4.47)
  })
  it('flags overflow when the page scrolls sideways or an element pokes past the edge', () => {
    expect(evaluatePageSample('mobile', page()).overflow).toBeNull()
    expect(evaluatePageSample('mobile', page({ scrollWidth: 391 })).overflow).toBeNull() // 1 px tolerance
    expect(evaluatePageSample('mobile', page({ scrollWidth: 430 })).overflow).toEqual({ scrollWidth: 430, viewportWidth: 390, offenders: [] })
    expect(evaluatePageSample('mobile', page({ offenders: ['block:cta-banner div#0 (600px)'] })).overflow?.offenders).toEqual([
      'block:cta-banner div#0 (600px)',
    ])
  })
  it('names why a block is hidden', () => {
    const vm = evaluatePageSample(
      'desktop',
      page({
        viewportWidth: 1440,
        scrollWidth: 1440,
        blocks: [
          block({ key: 'block:a#0', display: 'none', width: 0, height: 0 }),
          block({ key: 'block:b#0', visibility: 'hidden' }),
          block({ key: 'block:c#0', opacity: 0.01 }),
          block({ key: 'block:d#0', height: 1 }),
          block({ key: 'block:e#0', left: -2000, right: -10 }),
          block({ key: 'block:ok#0' }),
        ],
      })
    )
    expect(vm.hidden).toEqual([
      { key: 'block:a#0', reason: 'display' },
      { key: 'block:b#0', reason: 'visibility' },
      { key: 'block:c#0', reason: 'opacity' },
      { key: 'block:d#0', reason: 'size' },
      { key: 'block:e#0', reason: 'offscreen' },
    ])
  })
})

describe('metricGateFailures', () => {
  const concept: RenderMetrics = {
    v: 1,
    viewports: [
      {
        viewport: 'mobile',
        textChecked: 3,
        textUnverified: 0,
        contrast: [
          { key: 'block:hero p#0', text: 'Faint', ratio: 1.9, required: 4.5, fontSizePx: 16 },
          { key: 'component:footer a#2', text: 'Privacy', ratio: 3.1, required: 4.5, fontSizePx: 14 },
        ],
        overflow: { scrollWidth: 430, viewportWidth: 390, offenders: ['block:cta-banner div#0 (600px)'] },
        hidden: [{ key: 'block:feature-grid#0', reason: 'display' }],
      },
    ],
  }
  it('with no baseline every failure counts, with readable messages', () => {
    const f = metricGateFailures(concept, null)
    expect(f.map((x) => x.kind)).toEqual(['contrast', 'contrast', 'overflow', 'hidden'])
    expect(f[0].message).toBe('Mobile (390): “Faint” (hero › p) is 1.90:1 — needs 4.5:1')
    expect(f[2].message).toBe('Mobile (390): the page is wider than the screen (430 px at 390 px) — e.g. cta-banner › div (600px)')
    expect(f[3].message).toBe('Mobile (390): the feature-grid block is hidden (display: none)')
  })
  it('ignores failures the current site already has (same viewport + key)', () => {
    const baseline: RenderMetrics = {
      v: 1,
      viewports: [
        {
          ...concept.viewports[0],
          contrast: [concept.viewports[0].contrast[1]],
          overflow: { scrollWidth: 400, viewportWidth: 390, offenders: [] },
          hidden: [],
        },
      ],
    }
    expect(metricGateFailures(concept, baseline).map((x) => x.kind)).toEqual(['contrast', 'hidden'])
  })
  it('describeKey turns our keys into short labels', () => {
    expect(describeKey('block:hero h1#0')).toBe('hero › h1')
    expect(describeKey('component:navbar a#3')).toBe('navbar › a')
    expect(describeKey('page p#2')).toBe('page › p')
    expect(describeKey('block:hero#0')).toBe('hero')
    expect(describeKey('weird')).toBe('weird')
  })
})

describe('parsers', () => {
  it('parseRawPageSample accepts the script’s shape and drops malformed entries', () => {
    const raw = { ...page(), text: [t(), { key: 1 }], blocks: [block(), null], offenders: ['x', 3] }
    const p = parseRawPageSample(raw)
    expect(p?.text).toHaveLength(1)
    expect(p?.blocks).toHaveLength(1)
    expect(p?.offenders).toEqual(['x'])
    expect(parseRawPageSample(null)).toBeNull()
    expect(parseRawPageSample({ viewportWidth: 'x' })).toBeNull()
  })
  it('parseRenderMetrics round-trips combineMetrics output and rejects junk', () => {
    const m = combineMetrics([evaluatePageSample('mobile', page({ scrollWidth: 430 }))])
    expect(parseRenderMetrics(JSON.parse(JSON.stringify(m)))).toEqual(m)
    expect(combineMetrics([])).toBeNull()
    expect(parseRenderMetrics({ v: 2, viewports: [] })).toBeNull()
    expect(parseRenderMetrics('x')).toBeNull()
  })
})

describe('contrast baseline diff uses the full, uncapped failure set (PF8)', () => {
  // 50 failing texts; the gray level sets severity. `order` flips which keys are worst.
  const many = (n: number, reversed: boolean, extra: RawTextSample[] = []): RawPageSample =>
    page({
      text: [
        ...Array.from({ length: n }, (_, i) => {
          const level = 130 + (reversed ? n - 1 - i : i) // 130..179, all below 4.5:1 on white
          return t({ key: `block:hero p#${i}`, text: `Line ${i}`, color: `rgb(${level}, ${level}, ${level})` })
        }),
        ...extra,
      ],
    })

  it('stores every failing key while displaying only the worst MAX_CONTRAST_FAILURES', () => {
    const vm = evaluatePageSample('mobile', many(50, false))
    expect(vm.contrast).toHaveLength(MAX_CONTRAST_FAILURES)
    expect(vm.contrastKeys).toHaveLength(50)
  })
  it('>40 shared failures with reordered severities yield zero new contrast failures', () => {
    const concept = combineMetrics([evaluatePageSample('mobile', many(50, false))])
    const baseline = combineMetrics([evaluatePageSample('mobile', many(50, true))])
    if (!concept || !baseline) throw new Error('expected metrics')
    // The displayed top-40 differ between the two…
    expect(concept.viewports[0].contrast.map((f) => f.key)).not.toEqual(baseline.viewports[0].contrast.map((f) => f.key))
    // …but nothing is genuinely new.
    expect(metricGateFailures(concept, baseline).filter((f) => f.kind === 'contrast')).toEqual([])
  })
  it('a genuinely new failure beyond the displayed cap still blocks', () => {
    const concept = combineMetrics([
      evaluatePageSample('mobile', many(50, false, [t({ key: 'block:faq p#0', text: 'Mild', color: 'rgb(125, 125, 125)' })])),
    ])
    const baseline = combineMetrics([evaluatePageSample('mobile', many(50, false))])
    if (!concept || !baseline) throw new Error('expected metrics')
    expect(concept.viewports[0].contrast.map((f) => f.key)).not.toContain('block:faq p#0')
    const f = metricGateFailures(concept, baseline)
    expect(f).toHaveLength(1)
    expect(f[0].kind).toBe('contrast')
    expect(f[0].message).toBe('Mobile (390): 1 more text element falls below AA contrast — e.g. faq › p')
  })
  it('parseRenderMetrics keeps contrastKeys and tolerates their absence', () => {
    const m = combineMetrics([evaluatePageSample('mobile', many(45, false))])
    expect(parseRenderMetrics(JSON.parse(JSON.stringify(m)))?.viewports[0].contrastKeys).toHaveLength(45)
    const legacy = { v: 1, viewports: [{ viewport: 'mobile', textChecked: 0, textUnverified: 0, contrast: [], overflow: null, hidden: [] }] }
    expect(parseRenderMetrics(legacy)?.viewports[0].contrastKeys).toBeUndefined()
  })
})
