import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ generateJson: vi.fn(), record: vi.fn<(a: unknown) => Promise<void>>(async () => {}) }))
vi.mock('@/lib/content/json-generation', () => ({ generateJson: (o: unknown) => m.generateJson(o) }))
vi.mock('@/lib/content/token-usage', () => ({ recordTokenUsage: (a: unknown) => m.record(a) }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: (id: string) => ({ modelId: id }) }))

import { VALID } from './__fixtures__/valid-bundle'
import { DRAFT_FILES, rawOf } from './__fixtures__/theme-texts'
import { DESIGN_SYSTEM_PROMPT } from './brief'
import { DEFAULT_CAPABILITIES } from './run-types'
import { DESIGN_MODEL } from '@/lib/content/generation-tuning'
import { reviseConcept, type ReviseConceptArgs } from './concept-reviser'

type Opts = { system?: string; beforeAttempt?: (n: 1 | 2) => boolean | Promise<boolean>; onAttempt?: (u: unknown, f: string) => Promise<void> | void; [k: string]: unknown }
const USAGE = { inputTokens: 20_000, outputTokens: 10_000, inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 } }
const NOW = 1_000_000
const REVISED = { ...VALID, name: 'Harbor Ledger II', palette: { ...VALID.palette, primary: '#1f4d3d', action: '#f25c05' } }
const args = (over: Partial<ReviseConceptArgs> = {}): ReviseConceptArgs => ({
  prompt: { staticPrefix: 'STATIC', parts: [{ type: 'text', text: 'SHARED' }, { type: 'text', text: 'TASK' }], sharedPartCount: 1 },
  context: { current: VALID, caps: DEFAULT_CAPABILITIES, paletteFreedom: 'evolve', draftFiles: DRAFT_FILES, model: 'claude-opus-5-5' },
  others: [],
  costSoFarUsd: 0,
  costCapUsd: 4,
  deadline: NOW + 540_000,
  attribution: { sessionId: 's', contentJobId: 'j', createdBy: 'a' },
  now: () => NOW,
  ...over,
})
let answer: unknown = null
let queue: unknown[] = [] // per-call answers; `answer` once empty
// 25 one-line rules → 75 lines once the sanitizer reformats them
const OVER = Array.from({ length: 25 }, () => '[data-block="hero"] h1 { letter-spacing: -0.02em; }').join('\n')
const OVERSIZED = { ...rawOf(REVISED), css: { blocks: { hero: OVER } } }

beforeEach(() => {
  answer = { concepts: [rawOf(REVISED)] }
  queue = []
  m.record.mockClear()
  m.generateJson.mockReset().mockImplementation(async (o: Opts) => {
    if (o.beforeAttempt && !(await o.beforeAttempt(1))) return null
    await o.onAttempt?.(USAGE, 'stop')
    return queue.length ? queue.shift() : answer
  })
})

describe('reviseConcept', () => {
  it('one call with the design system prompt, recorded as design_concept; returns the validated bundle', async () => {
    const r = await reviseConcept(args())
    expect((m.generateJson.mock.calls[0][0] as Opts).system).toBe(DESIGN_SYSTEM_PROMPT)
    expect(m.generateJson).toHaveBeenCalledTimes(1)
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ stage: 'design_concept' }))
    expect(r.concept?.bundle.name).toBe('Harbor Ledger II')
    expect(r.concept?.bundle.meta).toEqual({ source: 'concept', model: 'claude-opus-5-5' })
    expect(r.costUsd).toBeCloseTo(0.28, 6) // 20k × $4 + 10k × $20 per M
    expect(r.stoppedReason).toBeNull()
  })
  it('defaults to DESIGN_MODEL; a model override reaches the call, pricing and the usage row (A/B script)', async () => {
    await reviseConcept(args())
    expect((m.generateJson.mock.calls[0][0] as { model: { modelId: string } }).model.modelId).toBe(DESIGN_MODEL)
    m.generateJson.mockClear()
    m.record.mockClear()
    const r = await reviseConcept(args({ model: 'claude-fable-5-1' }))
    expect((m.generateJson.mock.calls[0][0] as { model: { modelId: string } }).model.modelId).toBe('claude-fable-5-1')
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ stage: 'design_concept', model: 'claude-fable-5-1' }))
    expect(r.costUsd).toBeCloseTo(0.7, 6) // 20k × $10 + 10k × $50 per M
  })
  it('adds the self-consistency notes to the revision (P7)', async () => {
    const r = await reviseConcept(args())
    expect(r.notes).toContainEqual(expect.stringMatching(/^Signature CSS: only 1 scoped css.blocks move/))
    expect(r.concept?.notes).toEqual(r.notes)
  })
  it('an invalid revision is no concept, with our validation errors — and no repair call', async () => {
    answer = { concepts: [{ ...rawOf(REVISED), palette: { ...VALID.palette, primary: 'blue' } }] }
    const r = await reviseConcept(args())
    expect(r.concept).toBeNull()
    expect(r.errors.join(' ')).toContain('palette.primary')
    expect(m.generateJson).toHaveBeenCalledTimes(1)
  })
  it('a revision that converges onto another concept is rejected as too similar', async () => {
    const r = await reviseConcept(args({ others: [{ position: 1, bundle: REVISED }] }))
    expect(r.concept).toBeNull()
    expect(r.errors[0]).toContain('too similar to concept 2')
  })
  it('an empty envelope is no concept', async () => {
    answer = { concepts: [] }
    const r = await reviseConcept(args())
    expect(r).toMatchObject({ concept: null, stoppedReason: 'no_output' })
    expect(r.errors[0]).toContain('no concept')
  })
  it('the cost cap vetoes the call', async () => {
    const r = await reviseConcept(args({ costSoFarUsd: 4 }))
    expect(r).toMatchObject({ concept: null, stoppedReason: 'cost_cap', costUsd: 0 })
  })
  describe('size-only repair', () => {
    it('an over-cap revision gets exactly one repair turn (answer replayed + the exact errors) and the repaired bundle is used', async () => {
      queue = [{ concepts: [OVERSIZED] }]
      const r = await reviseConcept(args())
      expect(m.generateJson).toHaveBeenCalledTimes(2)
      const repair = m.generateJson.mock.calls[1][0] as Opts & { messages: { role: string; content: unknown }[]; label: string }
      expect(repair.label).toBe('design-revise-repair')
      const [assistant, user] = repair.messages.slice(-2)
      expect(assistant).toEqual({ role: 'assistant', content: JSON.stringify({ concepts: [OVERSIZED] }) })
      expect(user.content).toContain('css.blocks.hero: The CSS has 75 lines (max 60).')
      expect(user.content).toContain('Shorten the CSS to fit the budget, keeping the design intent')
      expect(r.concept?.bundle.name).toBe('Harbor Ledger II')
      expect(r.concept?.bundle.css.blocks.hero?.split('\n')).toHaveLength(3) // the repaired (short) hero, sanitized
      expect(r.stoppedReason).toBeNull()
      expect(m.record).toHaveBeenCalledTimes(2)
      for (const [a] of m.record.mock.calls) expect(a).toMatchObject({ stage: 'design_concept' })
      expect(r.costUsd).toBeCloseTo(0.56, 6)
    })
    it('over the cap twice → rejected with both errors, no third call', async () => {
      answer = { concepts: [OVERSIZED] }
      const r = await reviseConcept(args())
      expect(m.generateJson).toHaveBeenCalledTimes(2)
      expect(r).toMatchObject({ concept: null, stoppedReason: 'no_output' })
      expect(r.errors).toEqual(['css.blocks.hero: The CSS has 75 lines (max 60).', 'after repair: css.blocks.hero: The CSS has 75 lines (max 60).'])
    })
    it('a size error mixed with any other error → no repair', async () => {
      const mixed = { ...OVERSIZED, css: { global: 'body { position: fixed; }', blocks: { hero: OVER } } }
      answer = { concepts: [mixed] }
      const r = await reviseConcept(args())
      expect(r.concept).toBeNull()
      expect(r.errors.some((e) => e.includes('75 lines'))).toBe(true)
      expect(r.errors.length).toBeGreaterThan(1)
      expect(m.generateJson).toHaveBeenCalledTimes(1)
    })
    it('the cost cap vetoes the repair: rejected with the size errors, no extra spend', async () => {
      queue = [{ concepts: [OVERSIZED] }]
      const r = await reviseConcept(args({ costCapUsd: 0.2 })) // the first call spends $0.28
      expect(m.generateJson).toHaveBeenCalledTimes(1)
      expect(r).toMatchObject({ concept: null, stoppedReason: 'cost_cap' })
      expect(r.errors).toEqual(['css.blocks.hero: The CSS has 75 lines (max 60).'])
      expect(r.costUsd).toBeCloseTo(0.28, 6)
      expect(m.record).toHaveBeenCalledTimes(1)
    })
    it('too little time left vetoes the repair: rejected, no extra spend', async () => {
      queue = [{ concepts: [OVERSIZED] }]
      let t = NOW
      const r = await reviseConcept(args({ now: () => t, onSpend: () => void (t = NOW + 540_000 - 100_000) })) // 80 s usable < 90 s floor
      expect(m.generateJson).toHaveBeenCalledTimes(1)
      expect(r).toMatchObject({ concept: null, stoppedReason: 'deadline' })
      expect(r.costUsd).toBeCloseTo(0.28, 6)
    })
  })
})
