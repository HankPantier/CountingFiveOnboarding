import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ generateJson: vi.fn(), record: vi.fn<(a: unknown) => Promise<void>>(async () => {}) }))
vi.mock('@/lib/content/json-generation', () => ({ generateJson: (o: unknown) => m.generateJson(o) }))
vi.mock('@/lib/content/token-usage', () => ({ recordTokenUsage: (a: unknown) => m.record(a) }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: (id: string) => ({ modelId: id }) }))

import { VALID } from './__fixtures__/valid-bundle'
import { DRAFT_FILES, rawOf } from './__fixtures__/theme-texts'
import { DESIGN_SYSTEM_PROMPT } from './brief'
import { DEFAULT_CAPABILITIES } from './run-types'
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

beforeEach(() => {
  answer = { concepts: [rawOf(REVISED)] }
  m.record.mockClear()
  m.generateJson.mockReset().mockImplementation(async (o: Opts) => {
    if (o.beforeAttempt && !(await o.beforeAttempt(1))) return null
    await o.onAttempt?.(USAGE, 'stop')
    return answer
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
})
