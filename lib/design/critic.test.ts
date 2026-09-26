import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ generateJson: vi.fn(), record: vi.fn<(a: unknown) => Promise<void>>(async () => {}) }))
vi.mock('@/lib/content/json-generation', () => ({ generateJson: (o: unknown) => m.generateJson(o) }))
vi.mock('@/lib/content/token-usage', () => ({ recordTokenUsage: (a: unknown) => m.record(a) }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: (id: string) => ({ modelId: id }) }))

import { DESIGN_MODEL } from '@/lib/content/generation-tuning'
import { CRITIC_SYSTEM_PROMPT } from './brief/critique-prompt'
import { CRITIQUE_OUTPUT_TOKENS, critiqueConcept, type CritiqueConceptArgs } from './critic'

type Opts = { system?: string; messages: { content: { providerOptions?: unknown; type: string }[] }[]; beforeAttempt?: (n: 1 | 2) => boolean | Promise<boolean>; onAttempt?: (u: unknown, f: string) => Promise<void> | void; firstBudget: number; [k: string]: unknown }
const USAGE = { inputTokens: 12_000, outputTokens: 2_000, inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 } }
const NOW = 1_000_000
const GOOD = {
  scores: { brandFit: 4, distinctiveness: 4, hierarchy: 4, legibility: 4, consistency: 4, craft: 4 },
  reasons: { brandFit: 'a', distinctiveness: 'b', hierarchy: 'c', legibility: 'd', consistency: 'e', craft: 'f' },
  issues: [{ area: 'hero', problem: 'p', fix: 'f' }],
  summary: 's',
}
const args = (over: Partial<CritiqueConceptArgs> = {}): CritiqueConceptArgs => ({
  prompt: {
    staticPrefix: 'STATIC',
    parts: [{ type: 'text', text: 'FIRM' }, { type: 'image', image: new Uint8Array([1]), mediaType: 'image/webp' }, { type: 'text', text: 'TASK' }],
    sharedPartCount: 2,
  },
  iteration: 1,
  costSoFarUsd: 0,
  costCapUsd: 4,
  deadline: NOW + 540_000,
  attribution: { sessionId: 's', contentJobId: 'j', createdBy: 'a' },
  now: () => NOW,
  ...over,
})
let answer: unknown = GOOD
let seen: Opts | null = null

beforeEach(() => {
  answer = GOOD
  seen = null
  m.record.mockClear()
  m.generateJson.mockReset().mockImplementation(async (o: Opts) => {
    seen = o
    if (o.beforeAttempt && !(await o.beforeAttempt(1))) return null
    await o.onAttempt?.(USAGE, 'stop')
    return answer
  })
})

describe('critiqueConcept', () => {
  it('one vision call: critic system prompt, cache breakpoint on the shared image, no sampling / tool knobs', async () => {
    const r = await critiqueConcept(args())
    const o = seen as unknown as Opts
    expect(o.system).toBe(CRITIC_SYSTEM_PROMPT)
    expect(o.firstBudget).toBe(CRITIQUE_OUTPUT_TOKENS)
    const content = o.messages[0].content
    expect(content[2].type).toBe('image')
    expect(content[2].providerOptions).toBeDefined() // breakAt = sharedPartCount - 1
    for (const k of ['temperature', 'topP', 'topK', 'toolChoice']) expect(k in o).toBe(false)
    expect(m.generateJson).toHaveBeenCalledTimes(1)
    expect(r.critique?.passed).toBe(true)
    expect(r.critique?.iteration).toBe(1)
  })
  it('records usage as design_critique and returns the call’s cost', async () => {
    const r = await critiqueConcept(args())
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ stage: 'design_critique', cacheTtl: '5m' }))
    // $4/$20 per M: 12k in + 2k out = $0.088.
    expect(r.costUsd).toBeCloseTo(0.088, 6)
    expect(r.stoppedReason).toBeNull()
  })
  it('computes pass server-side, ignoring the model’s own verdict', async () => {
    answer = { ...GOOD, scores: { ...GOOD.scores, distinctiveness: 2 }, pass: true }
    expect((await critiqueConcept(args())).critique?.passed).toBe(false)
  })
  it('an unparseable answer is no critique, with the validation errors', async () => {
    answer = { scores: { brandFit: 9 } }
    const r = await critiqueConcept(args())
    expect(r.critique).toBeNull()
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.stoppedReason).toBe('no_output')
  })
  it('the cost cap vetoes the call before it starts', async () => {
    const r = await critiqueConcept(args({ costSoFarUsd: 4 }))
    expect(r).toMatchObject({ critique: null, stoppedReason: 'cost_cap', costUsd: 0 })
    expect(m.record).not.toHaveBeenCalled()
  })
})

describe('critiqueConcept model override', () => {
  it('defaults to DESIGN_MODEL and judges with an override (CRITIC_MODEL in the A/B script) when given', async () => {
    const d = await critiqueConcept(args())
    expect((seen as unknown as { model: { modelId: string } }).model.modelId).toBe(DESIGN_MODEL)
    expect(d.critique?.model).toBe(DESIGN_MODEL)
    const o = await critiqueConcept(args({ model: 'claude-sonnet-5' }))
    expect((seen as unknown as { model: { modelId: string } }).model.modelId).toBe('claude-sonnet-5')
    expect(o.critique?.model).toBe('claude-sonnet-5')
    expect(m.record).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'design_critique', model: 'claude-sonnet-5' }))
  })
})
