import { describe, it, expect } from 'vitest'
import { VALID } from '../__fixtures__/valid-bundle'
import { DEFAULT_CAPABILITIES } from '../run-types'
import type { CritiqueRecord } from '../critique'
import { CSS_RULES_REMINDER } from './contract'
import { buildConceptPrompt, buildSharedParts, buildStaticPrefix, type SharedPromptArgs } from './index'
import { buildRevisePrompt, formatCritique, type RevisePromptArgs } from './revise-prompt'

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
  it('formatCritique lists scores with reasons, then numbered issues and the summary', () => {
    const f = formatCritique(CRIT)
    expect(f.split('\n')[0]).toBe('Scores (mean 3.5; passes at every score ≥ 3, mean ≥ 3.8, distinctiveness ≥ 4):')
    expect(f).toContain('Summary: Timid.')
  })
})
