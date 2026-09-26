import { describe, it, expect } from 'vitest'
import { VALID } from '../__fixtures__/valid-bundle'
import { DEFAULT_CAPABILITIES } from '../run-types'
import type { CritiqueRecord } from '../critique'
import { CSS_RULES_REMINDER } from './contract'
import { buildConceptPrompt, buildSharedParts, buildStaticPrefix, type SharedPromptArgs } from './index'
import { buildRevisePrompt, formatCritique, formatCssBudget, type RevisePromptArgs } from './revise-prompt'
import { MAX_GLOBAL_BYTES, MAX_GLOBAL_LINES, MAX_TARGET_BYTES, MAX_TARGET_LINES } from '../css-budget'

const SHARED: SharedPromptArgs = {
  caps: DEFAULT_CAPABILITIES,
  paletteFreedom: 'evolve',
  current: VALID,
  firmName: 'Korbey Lague PLLP',
  schema: { brand: { currentTone: 'Warm' } },
  designMd: null,
  adminBrief: 'Boutique, not big-four.',
  images: [],
  blockSamples: '<section data-block="hero"><h1>Hi</h1></section>',
  pagePath: '/',
}
const CRIT: CritiqueRecord = {
  iteration: 0,
  scores: { brandFit: 4, distinctiveness: 2, hierarchy: 4, legibility: 3, consistency: 4, craft: 4 },
  reasons: { brandFit: 'ok', distinctiveness: 'Too close to the current navy', hierarchy: 'ok', legibility: 'Small grey captions', consistency: 'ok', craft: 'ok' },
  issues: [{ area: 'hero', problem: 'Looks like the old site', fix: 'Shift primary toward oxblood' }],
  summary: 'Timid.',
  passed: false,
  mean: 3.5,
  model: 'claude-opus-5-5',
  paletteFreedom: 'free',
  at: '2026-09-25T12:00:00.000Z',
}
const ARGS: RevisePromptArgs = {
  ...SHARED,
  position: 0,
  conceptCount: 2,
  round: 1,
  bundle: VALID,
  others: [{ position: 1, bundle: { ...VALID, name: 'Oxblood Ledger' } }],
  critique: CRIT,
  gateFailures: ['Mobile (390): the page is wider than the screen (430 px at 390 px)'],
  desktop: new Uint8Array([2]),
  mobile: new Uint8Array([3]),
}
const texts = (parts: ReturnType<typeof buildRevisePrompt>['parts']) => parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n')

describe('buildRevisePrompt', () => {
  const built = buildRevisePrompt(ARGS)
  const all = texts(built.parts)
  it('reuses the concept prompt’s static prefix (same cache entry) and its shared parts (no reference images)', () => {
    expect(built.staticPrefix).toBe(buildStaticPrefix(DEFAULT_CAPABILITIES))
    expect(built.staticPrefix).toBe(buildConceptPrompt({ ...SHARED, conceptCount: 2, position: 0, priors: [] }).staticPrefix)
    expect(built.parts.slice(0, built.sharedPartCount)).toEqual(buildSharedParts({ ...SHARED, images: [] }))
  })
  it('carries the current bundle (with its CSS), the fenced critique, the render failures and both renders', () => {
    expect(all).toContain('"name":"Harbor Ledger"')
    expect(all).toContain('"css":')
    expect(all).toContain('<<<CRITIQUE')
    expect(all).toContain('Distinctiveness 2/5 — Too close to the current navy')
    expect(all).toContain('1. [hero] Looks like the old site → Shift primary toward oxblood')
    expect(all).toContain('wider than the screen')
    expect(all).toContain('Concept 2 "Oxblood Ledger"')
    expect(built.parts.filter((p) => p.type === 'image')).toHaveLength(2)
  })
  it('ends with the task: round r, exactly one concept, the CSS reminder', () => {
    const last = built.parts[built.parts.length - 1]
    const text = last.type === 'text' ? last.text : ''
    expect(text).toContain('Revise concept 1 of 2 (revision round 1)')
    expect(text).toContain('exactly ONE concept')
    expect(text).toContain(CSS_RULES_REMINDER)
  })
  it('restates the concept’s claim-check / signature-CSS notes after its CSS budget (per call)', () => {
    const idx = built.parts.findIndex((p) => p.type === 'text' && p.text.startsWith('CLAIM CHECK'))
    expect(idx).toBeGreaterThanOrEqual(built.sharedPartCount)
    const t = built.parts[idx]
    expect(t.type === 'text' && t.text).toContain('Signature CSS: only 1 scoped css.blocks move') // VALID styles only the hero
    const clean = { ...VALID, css: { blocks: { ...VALID.css.blocks, footer: '[data-component="footer"] a { text-decoration: underline; }' } } }
    expect(texts(buildRevisePrompt({ ...ARGS, bundle: clean }).parts)).not.toContain('CLAIM CHECK')
  })
  it('formatCritique lists scores with reasons, then numbered issues and the summary', () => {
    const f = formatCritique(CRIT)
    expect(f.split('\n')[0]).toBe('Scores (mean 3.5; passes at every score ≥ 3, mean ≥ 3.8, distinctiveness ≥ 4 at palette freedom free):')
    expect(formatCritique({ ...CRIT, paletteFreedom: 'evolve' }).split('\n')[0]).toContain('distinctiveness ≥ 3 at palette freedom evolve')
    expect(f).toContain('Summary: Timid.')
  })
  it('carries a per-call CSS budget: each fragment’s lines/bytes vs the sanitizer caps — never in the static prefix', () => {
    const hero = Array.from({ length: 52 }, (_, i) => (i % 3 === 0 ? '[data-block="hero"] h1 {' : i % 3 === 1 ? '    margin: 0' : '}')).join('\n') + '\n[data-block="hero"] h2 {\n    margin: 0\n}'
    const b = buildRevisePrompt({ ...ARGS, bundle: { ...VALID, css: { global: 'body {\n    margin: 0\n}', blocks: { hero } } } })
    const budget = texts(b.parts.slice(b.sharedPartCount))
    expect(budget).toContain('CSS BUDGET')
    expect(budget).toContain(`- css.global: 3/${MAX_GLOBAL_LINES} lines, 22/${MAX_GLOBAL_BYTES.toLocaleString('en-US')} bytes`)
    expect(budget).toMatch(new RegExp(`- css\\.blocks\\.hero: 55/${MAX_TARGET_LINES} lines, [\\d,]+/${MAX_TARGET_BYTES.toLocaleString('en-US')} bytes — near the cap`))
    expect(budget).toContain(`any other block: ${MAX_TARGET_LINES} lines`)
    expect(budget).toContain('tighten or drop rules rather than add them')
    expect(b.staticPrefix).not.toContain('CSS BUDGET')
    expect(b.staticPrefix).toBe(buildStaticPrefix(DEFAULT_CAPABILITIES)) // byte-stable across bundles
    expect(b.staticPrefix).toBe(built.staticPrefix)
    expect(b.parts.slice(0, b.sharedPartCount)).toEqual(built.parts.slice(0, built.sharedPartCount))
  })
  it('formatCssBudget counts lines exactly as the sanitizer does', () => {
    expect(formatCssBudget({ blocks: { hero: VALID.css.blocks.hero } })).toContain(`- css.blocks.hero: 1/${MAX_TARGET_LINES} lines`)
    expect(formatCssBudget({ blocks: {} })).toContain('(no CSS yet)')
  })
})
