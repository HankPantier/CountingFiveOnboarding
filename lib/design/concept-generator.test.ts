import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({ generateJson: vi.fn(), record: vi.fn<(a: unknown) => Promise<void>>(async () => {}) }))
vi.mock('@/lib/content/json-generation', () => ({ generateJson: (o: unknown) => m.generateJson(o) }))
vi.mock('@/lib/content/token-usage', () => ({ recordTokenUsage: (a: unknown) => m.record(a) }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: (id: string) => ({ modelId: id }) }))

import { VALID } from './__fixtures__/valid-bundle'
import { DRAFT_FILES, rawOf } from './__fixtures__/theme-texts'
import { DESIGN_SYSTEM_PROMPT } from './brief'
import {
  CONCEPT_CALL_TIMEOUT_MS,
  ESTIMATED_TOKENS_PER_IMAGE,
  MIN_REPAIR_TIMEOUT_MS,
  REPAIR_CALL_TIMEOUT_MS,
  generateConcepts,
  type GenerateConceptsArgs,
} from './concept-generator'
import { DEFAULT_CAPABILITIES } from './run-types'

const A = rawOf(VALID)
const B = rawOf({
  ...VALID,
  name: 'Oxblood Ledger',
  palette: { ...VALID.palette, primary: '#5c1a2b', action: '#e0a526' },
  treatments: { headlineStyle: 'sans', eyebrowStyle: 'standard', darkSections: false },
})
const C = rawOf({
  ...VALID,
  name: 'Pine Assembly',
  palette: { ...VALID.palette, primary: '#1f4d3d', action: '#f25c05' },
  tokens: { ...VALID.tokens, roundness: 'sharp', density: 'airy' },
})
const BROKEN = { ...B, palette: { ...VALID.palette, primary: 'blue' } }

type Opts = {
  messages: { role: string; content: unknown }[]
  beforeAttempt?: (n: 1 | 2) => boolean | Promise<boolean>
  onAttempt?: (usage: unknown, finish: string) => void | Promise<void>
  timeoutMs?: number
  [k: string]: unknown
}
let scripted: unknown[] = []
// Simulated wall-clock time each generateJson call takes (shifted per call).
let elapsed: number[] = []
// timeoutMs as generateJson would read it for each ALLOWED attempt.
let timeouts: number[] = []
const NOW = 1_000_000
let clock = NOW

function args(over: Partial<GenerateConceptsArgs> = {}): GenerateConceptsArgs {
  return {
    prompt: { staticPrefix: 'STATIC', parts: [{ type: 'text', text: 'TASK' }] },
    context: { current: VALID, caps: DEFAULT_CAPABILITIES, paletteFreedom: 'evolve', draftFiles: DRAFT_FILES, model: 'claude-opus-5-5' },
    conceptCount: 3,
    costSoFarUsd: 0,
    costCapUsd: 4,
    deadline: NOW + 540_000,
    attribution: { sessionId: 'sess', contentJobId: 'job', createdBy: 'admin-1' },
    now: () => clock,
    ...over,
  }
}

const USAGE = { inputTokens: 10_000, outputTokens: 5_000, inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 } }

beforeEach(() => {
  scripted = []
  elapsed = []
  timeouts = []
  clock = NOW
  m.record.mockClear()
  m.generateJson.mockReset().mockImplementation(async (opts: Opts) => {
    if (opts.beforeAttempt && !(await opts.beforeAttempt(1))) return null
    timeouts.push(opts.timeoutMs as number)
    clock += elapsed.shift() ?? 0
    // Opus 5.5 at $4/$20: 10k in + 5k out = $0.14 per call.
    await opts.onAttempt?.(USAGE, 'stop')
    return scripted.shift() ?? null
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('generateConcepts', () => {
  it('one call → three validated concepts, usage recorded and costed', async () => {
    scripted = [{ concepts: [A, B, C] }]
    const r = await generateConcepts(args())
    expect(r.concepts.map((c) => c.bundle.name)).toEqual(['Harbor Ledger', 'Oxblood Ledger', 'Pine Assembly'])
    expect(r.rejected).toEqual([])
    expect(r.stoppedReason).toBeNull()
    expect(r.costUsd).toBeCloseTo(0.14, 6)
    expect(r.estimatedUsd).toBe(0)
    expect(m.generateJson).toHaveBeenCalledTimes(1)
    expect(m.record).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'content', stage: 'design_concept', model: 'claude-opus-5-5', sessionId: 'sess', contentJobId: 'job', createdBy: 'admin-1', cacheTtl: '5m' })
    )
  })

  it('calls Opus 5.5 with cached multi-part messages, adaptive thinking, and no sampling / tool-choice params', async () => {
    scripted = [{ concepts: [A, B, C] }]
    await generateConcepts(args())
    const opts = m.generateJson.mock.calls[0][0] as Opts & { model: { modelId: string }; providerOptions: { anthropic: { thinking: { type: string } } } }
    expect(opts.model.modelId).toBe('claude-opus-5-5')
    expect(opts.providerOptions.anthropic.thinking.type).toBe('adaptive')
    for (const k of ['temperature', 'topP', 'topK', 'toolChoice', 'prompt']) expect(k in opts).toBe(false)
    expect(opts.messages).toHaveLength(1)
    expect(timeouts).toEqual([CONCEPT_CALL_TIMEOUT_MS])
  })

  it('repairs ONLY the invalid concept, once, as a follow-up turn', async () => {
    scripted = [{ concepts: [A, BROKEN, C] }, { concepts: [B] }]
    const r = await generateConcepts(args())
    expect(r.concepts.map((c) => c.bundle.name)).toEqual(['Harbor Ledger', 'Oxblood Ledger', 'Pine Assembly'])
    expect(m.generateJson).toHaveBeenCalledTimes(2)
    const repair = m.generateJson.mock.calls[1][0] as Opts
    expect(repair.messages).toHaveLength(3)
    expect(repair.messages[1].role).toBe('assistant')
    expect(String(repair.messages[2].content)).toContain('Concept 2')
    expect(String(repair.messages[2].content)).toContain('palette.primary')
  })

  it('keeps the survivors and reports a concept that is still broken after the repair', async () => {
    scripted = [{ concepts: [A, BROKEN, C] }, { concepts: [BROKEN] }]
    const r = await generateConcepts(args())
    expect(r.concepts).toHaveLength(2)
    expect(r.rejected).toHaveLength(1)
    expect(r.rejected[0].errors.join(' ')).toContain('palette.primary')
    expect(m.generateJson).toHaveBeenCalledTimes(2)
  })

  it('sends a near-duplicate to the repair pass', async () => {
    scripted = [{ concepts: [A, { ...A, name: 'Echo' }, C] }, { concepts: [B] }]
    const r = await generateConcepts(args())
    const repair = m.generateJson.mock.calls[1][0] as Opts
    expect(String(repair.messages[2].content)).toContain('too similar to concept 1')
    expect(r.concepts.map((c) => c.bundle.name)).toEqual(['Harbor Ledger', 'Oxblood Ledger', 'Pine Assembly'])
  })

  it('never calls the model once the run is at its cost cap', async () => {
    const r = await generateConcepts(args({ costSoFarUsd: 4, costCapUsd: 4 }))
    expect(m.generateJson).toHaveBeenCalledTimes(1) // generateJson is entered, but beforeAttempt vetoes the model call
    expect(m.record).not.toHaveBeenCalled()
    expect(r.stoppedReason).toBe('cost_cap')
    expect(r.concepts).toEqual([])
    expect(r.costUsd).toBe(0)
  })

  it('skips the repair when the first call pushed the run over its cap', async () => {
    scripted = [{ concepts: [A, BROKEN, C] }]
    const r = await generateConcepts(args({ costCapUsd: 0.1 }))
    expect(m.record).toHaveBeenCalledTimes(1)
    expect(r.concepts).toHaveLength(2)
    expect(r.notes).toContain('Skipped the repair pass — the run hit its cost cap.')
  })

  it('does not start a call that could overrun the invocation deadline', async () => {
    // 300 s left < 360 s first-call timeout + 20 s safety.
    const r = await generateConcepts(args({ deadline: NOW + 300_000 }))
    expect(m.record).not.toHaveBeenCalled()
    expect(r.stoppedReason).toBe('deadline')
  })

  it('reports no_output when the model returns nothing usable', async () => {
    scripted = [null]
    const r = await generateConcepts(args())
    expect(r.stoppedReason).toBe('no_output')
    expect(r.concepts).toEqual([])
  })

  it('surfaces per-concept notes (e.g. capability strips) prefixed with the concept name', async () => {
    scripted = [{ concepts: [{ ...A, style: { cards: 'flat' } }, B, C] }]
    const r = await generateConcepts(args())
    expect(r.notes).toContain('Harbor Ledger: Style axes are not available on this site yet — the concept’s style settings were dropped.')
  })

  describe('dynamic repair timeout', () => {
    it('vetoes the repair when under 90 s would remain for it', async () => {
      // 540 − 440 − 20 safety = 80 s < 90 s minimum.
      scripted = [{ concepts: [A, BROKEN, C] }, { concepts: [B] }]
      elapsed = [440_000]
      const r = await generateConcepts(args())
      expect(m.record).toHaveBeenCalledTimes(1)
      expect(timeouts).toEqual([CONCEPT_CALL_TIMEOUT_MS])
      expect(r.concepts).toHaveLength(2)
      expect(r.rejected).toHaveLength(1)
      expect(r.stoppedReason).toBeNull()
      expect(r.notes).toContain('Skipped the repair pass — not enough time left in this step.')
    })

    it('gives the repair the reduced remaining time when 90–150 s are left', async () => {
      // 540 − 400 − 20 safety = 120 s.
      scripted = [{ concepts: [A, BROKEN, C] }, { concepts: [B] }]
      elapsed = [400_000]
      const r = await generateConcepts(args())
      expect(timeouts).toEqual([CONCEPT_CALL_TIMEOUT_MS, 120_000])
      expect(r.concepts).toHaveLength(3)
    })

    it('caps the repair timeout at REPAIR_CALL_TIMEOUT_MS when plenty of time is left', async () => {
      scripted = [{ concepts: [A, BROKEN, C] }, { concepts: [B] }]
      elapsed = [100_000]
      await generateConcepts(args())
      expect(timeouts).toEqual([CONCEPT_CALL_TIMEOUT_MS, REPAIR_CALL_TIMEOUT_MS])
      expect(REPAIR_CALL_TIMEOUT_MS).toBeGreaterThan(MIN_REPAIR_TIMEOUT_MS)
    })

    it('an internal generateJson retry also gets the dynamic timeout', async () => {
      m.generateJson.mockImplementationOnce(async (opts: Opts) => {
        if (!(await opts.beforeAttempt?.(1))) return null
        timeouts.push(opts.timeoutMs as number)
        clock += 200_000
        await opts.onAttempt?.(USAGE, 'length') // truncated → parse failure → retry
        if (!(await opts.beforeAttempt?.(2))) return null
        timeouts.push(opts.timeoutMs as number)
        await opts.onAttempt?.(USAGE, 'stop')
        return { concepts: [A, B, C] }
      })
      const r = await generateConcepts(args())
      // 540 − 200 − 20 = 320 s, under the 360 s first-call cap.
      expect(timeouts).toEqual([CONCEPT_CALL_TIMEOUT_MS, 320_000])
      expect(r.concepts).toHaveLength(3)
      expect(r.costUsd).toBeCloseTo(0.28, 6)
    })
  })

  describe('aborted attempts', () => {
    const IMG = { type: 'image' as const, image: new Uint8Array([1, 2, 3]), mediaType: 'image/webp' }
    const estimateFor = (textChars: number, images: number) =>
      ((Math.ceil(textChars / 4) + images * ESTIMATED_TOKENS_PER_IMAGE) / 1_000_000) * 4 // Opus 5.5 input $4/M

    it('adds an estimated input-only cost for a started attempt that never reported usage, and warns', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      m.generateJson.mockImplementationOnce(async (opts: Opts) => {
        if (!(await opts.beforeAttempt?.(1))) return null
        return null // aborted by the timeout: onAttempt never fires
      })
      const r = await generateConcepts(args({ prompt: { staticPrefix: 'STATIC', parts: [{ type: 'text', text: 'TASK' }, IMG] } }))
      const expected = estimateFor(DESIGN_SYSTEM_PROMPT.length + 'STATIC'.length + 'TASK'.length, 1)
      expect(r.estimatedUsd).toBeCloseTo(expected, 9)
      expect(r.costUsd).toBeCloseTo(expected, 9)
      expect(m.record).not.toHaveBeenCalled() // token_usage stays exact-only
      expect(r.stoppedReason).toBe('no_output')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[design-concept] aborted attempt — estimated input cost $'))
    })

    it('counts an aborted first attempt against the cap before the internal retry', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const allowed: boolean[] = []
      m.generateJson.mockImplementationOnce(async (opts: Opts) => {
        allowed.push(Boolean(await opts.beforeAttempt?.(1)))
        allowed.push(Boolean(await opts.beforeAttempt?.(2)))
        return null
      })
      const est = estimateFor(DESIGN_SYSTEM_PROMPT.length + 'STATIC'.length + 'TASK'.length, 0)
      const r = await generateConcepts(args({ costCapUsd: est / 2 }))
      expect(allowed).toEqual([true, false])
      expect(r.stoppedReason).toBe('cost_cap')
      expect(r.costUsd).toBeCloseTo(est, 9)
    })

    it('does not estimate attempts that did report usage', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      scripted = [{ concepts: [A, BROKEN, C] }, { concepts: [B] }]
      const r = await generateConcepts(args())
      expect(r.estimatedUsd).toBe(0)
      expect(r.costUsd).toBeCloseTo(0.28, 6)
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('aborted attempt'))
    })
  })
})
