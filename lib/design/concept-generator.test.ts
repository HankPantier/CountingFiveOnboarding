import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({ generateJson: vi.fn(), record: vi.fn<(a: unknown) => Promise<void>>(async () => {}) }))
vi.mock('@/lib/content/json-generation', () => ({ generateJson: (o: unknown) => m.generateJson(o) }))
vi.mock('@/lib/content/token-usage', () => ({ recordTokenUsage: (a: unknown) => m.record(a) }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: (id: string) => ({ modelId: id }) }))

import { VALID } from './__fixtures__/valid-bundle'
import { DRAFT_FILES, rawOf } from './__fixtures__/theme-texts'
import { DESIGN_SYSTEM_PROMPT } from './brief'
import {
  DEADLINE_SAFETY_MS,
  FIRST_ATTEMPT_CAP_MS,
  ESTIMATED_TOKENS_PER_IMAGE,
  MIN_REPAIR_TIMEOUT_MS,
  REPAIR_CALL_TIMEOUT_MS,
  generateConcept,
  type GenerateConceptArgs,
} from './concept-generator'
import { DEFAULT_CAPABILITIES } from './run-types'
import { DESIGN_MODEL } from '@/lib/content/generation-tuning'

const A = rawOf(VALID)
const OXBLOOD: typeof VALID = {
  ...VALID,
  name: 'Oxblood Ledger',
  palette: { ...VALID.palette, primary: '#5c1a2b', action: '#e0a526' },
  treatments: { headlineStyle: 'sans', eyebrowStyle: 'standard', darkSections: false },
}
const B = rawOf(OXBLOOD)
const C = rawOf({
  ...VALID,
  name: 'Pine Assembly',
  palette: { ...VALID.palette, primary: '#1f4d3d', action: '#f25c05' },
  tokens: { ...VALID.tokens, roundness: 'sharp', density: 'airy' },
})
const BROKEN = { ...B, palette: { ...VALID.palette, primary: 'blue' } }
const ECHO = { ...A, name: 'Echo' } // a near-duplicate of A

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

function args(over: Partial<GenerateConceptArgs> = {}): GenerateConceptArgs {
  return {
    prompt: { staticPrefix: 'STATIC', parts: [{ type: 'text', text: 'TASK' }] },
    context: { current: VALID, caps: DEFAULT_CAPABILITIES, paletteFreedom: 'evolve', draftFiles: DRAFT_FILES, model: 'claude-opus-5-5' },
    priors: [],
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

describe('generateConcept', () => {
  it('one call → one validated concept, usage recorded and costed', async () => {
    scripted = [{ concepts: [A] }]
    const r = await generateConcept(args())
    expect(r.concept?.bundle.name).toBe('Harbor Ledger')
    expect(r.errors).toEqual([])
    expect(r.stoppedReason).toBeNull()
    expect(r.costUsd).toBeCloseTo(0.14, 6)
    expect(r.estimatedUsd).toBe(0)
    expect(m.generateJson).toHaveBeenCalledTimes(1)
    expect(m.record).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'content', stage: 'design_concept', model: 'claude-opus-5-5', sessionId: 'sess', contentJobId: 'job', createdBy: 'admin-1', cacheTtl: '5m' })
    )
  })

  it('calls Opus 5.5 with cached multi-part messages, adaptive thinking, a one-bundle budget and no sampling / tool-choice params', async () => {
    scripted = [{ concepts: [A] }]
    await generateConcept(args())
    const opts = m.generateJson.mock.calls[0][0] as Opts & { model: { modelId: string }; providerOptions: { anthropic: { thinking: { type: string } } } }
    expect(opts.model.modelId).toBe('claude-opus-5-5')
    expect(opts.providerOptions.anthropic.thinking.type).toBe('adaptive')
    for (const k of ['temperature', 'topP', 'topK', 'toolChoice', 'prompt']) expect(k in opts).toBe(false)
    expect(opts.messages).toHaveLength(1)
    expect(opts.firstBudget).toBe(24_000)
    expect(opts.retryBudget).toBe(24_000)
    // 540 − 0 − 20 safety = 520 s → capped at the 300 s first-attempt cap.
    expect(timeouts).toEqual([FIRST_ATTEMPT_CAP_MS])
    expect(FIRST_ATTEMPT_CAP_MS).toBe(300_000)
  })

  it('defaults to DESIGN_MODEL; a model override reaches the call, the pricing and the usage row (A/B script)', async () => {
    scripted = [{ concepts: [A] }]
    await generateConcept(args())
    expect((m.generateJson.mock.calls[0][0] as { model: { modelId: string } }).model.modelId).toBe(DESIGN_MODEL)

    m.generateJson.mockClear()
    m.record.mockClear()
    scripted = [{ concepts: [A] }]
    const r = await generateConcept(args({ model: 'claude-fable-5-1' }))
    expect((m.generateJson.mock.calls[0][0] as { model: { modelId: string } }).model.modelId).toBe('claude-fable-5-1')
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ stage: 'design_concept', model: 'claude-fable-5-1' }))
    // Fable 5.1 at $10/$50: 10k in + 5k out = $0.35.
    expect(r.costUsd).toBeCloseTo(0.35, 6)
  })

  it('repairs an invalid concept, once, as a follow-up turn', async () => {
    scripted = [{ concepts: [BROKEN] }, { concepts: [B] }]
    const r = await generateConcept(args())
    expect(r.concept?.bundle.name).toBe('Oxblood Ledger')
    expect(m.generateJson).toHaveBeenCalledTimes(2)
    const repair = m.generateJson.mock.calls[1][0] as Opts
    expect(repair.messages).toHaveLength(3)
    expect(repair.messages[1].role).toBe('assistant')
    expect(String(repair.messages[2].content)).toContain('palette.primary')
    expect(String(repair.messages[2].content)).toContain('exactly 1 replacement concept')
  })

  it('repairs an answer with no concept in it', async () => {
    scripted = [{ concepts: [] }, { concepts: [B] }]
    const r = await generateConcept(args())
    expect(String((m.generateJson.mock.calls[1][0] as Opts).messages[2].content)).toContain('missing')
    expect(r.concept?.bundle.name).toBe('Oxblood Ledger')
  })

  it('reports a concept that is still broken after the repair (no third call)', async () => {
    scripted = [{ concepts: [BROKEN] }, { concepts: [BROKEN] }]
    const r = await generateConcept(args())
    expect(r.concept).toBeNull()
    expect(r.errors.join(' ')).toContain('palette.primary')
    expect(r.errors.some((e) => e.startsWith('after repair: '))).toBe(true)
    expect(r.stoppedReason).toBe('no_output')
    expect(m.generateJson).toHaveBeenCalledTimes(2)
  })

  describe('distinctness against already-accepted concepts', () => {
    it('sends a near-duplicate of a prior concept to the repair pass, naming that concept', async () => {
      scripted = [{ concepts: [ECHO] }, { concepts: [B] }]
      const r = await generateConcept(args({ priors: [{ position: 1, bundle: VALID }] }))
      const repair = m.generateJson.mock.calls[1][0] as Opts
      expect(String(repair.messages[2].content)).toContain('too similar to concept 2 ("Harbor Ledger")')
      expect(r.concept?.bundle.name).toBe('Oxblood Ledger')
    })

    it('rejects a concept that is still a near-duplicate after the repair', async () => {
      scripted = [{ concepts: [ECHO] }, { concepts: [{ ...ECHO, name: 'Echo Two' }] }]
      const r = await generateConcept(args({ priors: [{ position: 0, bundle: VALID }] }))
      expect(r.concept).toBeNull()
      expect(r.errors.join(' ')).toContain('after repair: too similar to concept 1')
      expect(m.generateJson).toHaveBeenCalledTimes(2)
    })

    it('accepts a concept that differs from every prior', async () => {
      scripted = [{ concepts: [C] }]
      const r = await generateConcept(args({ priors: [{ position: 0, bundle: VALID }, { position: 1, bundle: OXBLOOD }] }))
      expect(r.concept?.bundle.name).toBe('Pine Assembly')
      expect(m.generateJson).toHaveBeenCalledTimes(1)
    })
  })

  it('never calls the model once the run is at its cost cap', async () => {
    const r = await generateConcept(args({ costSoFarUsd: 4, costCapUsd: 4 }))
    expect(m.generateJson).toHaveBeenCalledTimes(1) // generateJson is entered, but beforeAttempt vetoes the model call
    expect(m.record).not.toHaveBeenCalled()
    expect(r.stoppedReason).toBe('cost_cap')
    expect(r.concept).toBeNull()
    expect(r.costUsd).toBe(0)
  })

  it('skips the repair when the first call pushed the run over its cap', async () => {
    scripted = [{ concepts: [BROKEN] }]
    const r = await generateConcept(args({ costCapUsd: 0.1 }))
    expect(m.record).toHaveBeenCalledTimes(1)
    expect(r.concept).toBeNull()
    expect(r.errors.join(' ')).toContain('palette.primary')
    expect(r.stoppedReason).toBe('cost_cap')
    expect(r.notes).toContain('Skipped the repair pass — the run hit its cost cap.')
  })

  it('does not start a call that could overrun the invocation deadline', async () => {
    // 100 − 20 safety = 80 s < the 90 s minimum.
    const r = await generateConcept(args({ deadline: NOW + 100_000 }))
    expect(m.record).not.toHaveBeenCalled()
    expect(timeouts).toEqual([])
    expect(r.stoppedReason).toBe('deadline')
  })

  describe('first-attempt timeout', () => {
    it('gets the remaining budget when less than the cap is left', async () => {
      scripted = [{ concepts: [A] }]
      const r = await generateConcept(args({ deadline: NOW + 200_000 }))
      expect(timeouts).toEqual([200_000 - DEADLINE_SAFETY_MS])
      expect(r.concept).not.toBeNull()
    })

    it('with the 540 s budget and a 10 s gather, is capped at 300 s', async () => {
      scripted = [{ concepts: [A] }]
      clock = NOW + 10_000 // gather time already spent
      await generateConcept(args({ deadline: NOW + 540_000 }))
      expect(timeouts).toEqual([300_000])
    })

    it('with a very long gather, gets ≈ the remaining time (under the cap)', async () => {
      scripted = [{ concepts: [A] }]
      clock = NOW + 300_000
      await generateConcept(args({ deadline: NOW + 540_000 }))
      expect(timeouts).toEqual([540_000 - 300_000 - DEADLINE_SAFETY_MS])
    })
  })

  describe('onSpend', () => {
    it('reports the running total after every accounted call', async () => {
      scripted = [{ concepts: [BROKEN] }, { concepts: [B] }]
      const seen: number[] = []
      await generateConcept(args({ onSpend: (usd) => seen.push(usd) }))
      expect(seen).toHaveLength(2)
      expect(seen[0]).toBeCloseTo(0.14, 6)
      expect(seen[1]).toBeCloseTo(0.28, 6)
    })

    it('reports the aborted-attempt estimate, even when generateJson throws', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      m.generateJson.mockImplementationOnce(async (opts: Opts) => {
        await opts.beforeAttempt?.(1)
        throw new Error('socket hang up')
      })
      const seen: number[] = []
      await expect(generateConcept(args({ onSpend: (usd) => seen.push(usd) }))).rejects.toThrow('socket hang up')
      expect(seen).toHaveLength(1)
      expect(seen[0]).toBeGreaterThan(0)
    })
  })

  it('reports no_output when the model returns nothing usable', async () => {
    scripted = [null]
    const r = await generateConcept(args())
    expect(r.stoppedReason).toBe('no_output')
    expect(r.concept).toBeNull()
    expect(r.errors).toEqual([])
  })

  it('surfaces the concept’s notes (e.g. capability strips) prefixed with its name', async () => {
    scripted = [{ concepts: [{ ...A, style: { cards: 'flat' } }] }]
    const r = await generateConcept(args())
    expect(r.notes).toContain('Harbor Ledger: Style axes are not available on this site yet — the concept’s style settings were dropped.')
  })

  describe('dynamic repair timeout', () => {
    it('vetoes the repair when under 90 s would remain for it', async () => {
      // 540 − 440 − 20 safety = 80 s < 90 s minimum.
      scripted = [{ concepts: [BROKEN] }, { concepts: [B] }]
      elapsed = [440_000]
      const r = await generateConcept(args())
      expect(m.record).toHaveBeenCalledTimes(1)
      expect(timeouts).toEqual([FIRST_ATTEMPT_CAP_MS])
      expect(r.concept).toBeNull()
      expect(r.stoppedReason).toBe('deadline')
      expect(r.notes).toContain('Skipped the repair pass — not enough time left in this step.')
    })

    it('gives the repair the reduced remaining time when 90–150 s are left', async () => {
      // 540 − 400 − 20 safety = 120 s.
      scripted = [{ concepts: [BROKEN] }, { concepts: [B] }]
      elapsed = [400_000]
      const r = await generateConcept(args())
      expect(timeouts).toEqual([FIRST_ATTEMPT_CAP_MS, 120_000])
      expect(r.concept).not.toBeNull()
    })

    it('caps the repair timeout at REPAIR_CALL_TIMEOUT_MS when plenty of time is left', async () => {
      scripted = [{ concepts: [BROKEN] }, { concepts: [B] }]
      elapsed = [100_000]
      await generateConcept(args())
      expect(timeouts).toEqual([FIRST_ATTEMPT_CAP_MS, REPAIR_CALL_TIMEOUT_MS])
      expect(REPAIR_CALL_TIMEOUT_MS).toBeGreaterThan(MIN_REPAIR_TIMEOUT_MS)
    })

    it('an internal generateJson retry also gets the dynamic timeout', async () => {
      m.generateJson.mockImplementationOnce(async (opts: Opts) => {
        if (!(await opts.beforeAttempt?.(1))) return null
        timeouts.push(opts.timeoutMs as number)
        clock += 300_000
        await opts.onAttempt?.(USAGE, 'length') // truncated → parse failure → retry
        if (!(await opts.beforeAttempt?.(2))) return null
        timeouts.push(opts.timeoutMs as number)
        await opts.onAttempt?.(USAGE, 'stop')
        return { concepts: [A] }
      })
      const r = await generateConcept(args())
      // 540 − 300 − 20 = 220 s, under the 300 s first-call cap.
      expect(timeouts).toEqual([FIRST_ATTEMPT_CAP_MS, 220_000])
      expect(r.concept).not.toBeNull()
      expect(r.costUsd).toBeCloseTo(0.28, 6)
    })
  })

  describe('aborted attempts', () => {
    const IMG = { type: 'image' as const, image: new Uint8Array([1, 2, 3]), mediaType: 'image/webp' }
    // Opus 5.5 at $4/M input + the attempt's full maxOutputTokens at $20/M output.
    const estimateFor = (textChars: number, images: number, maxOutputTokens = 24_000) =>
      ((Math.ceil(textChars / 4) + images * ESTIMATED_TOKENS_PER_IMAGE) / 1_000_000) * 4 + (maxOutputTokens / 1_000_000) * 20

    it('adds an estimated input + max-output cost for a started attempt that never reported usage, and warns', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      m.generateJson.mockImplementationOnce(async (opts: Opts) => {
        if (!(await opts.beforeAttempt?.(1))) return null
        return null // aborted by the timeout: onAttempt never fires
      })
      const r = await generateConcept(args({ prompt: { staticPrefix: 'STATIC', parts: [{ type: 'text', text: 'TASK' }, IMG] } }))
      const expected = estimateFor(DESIGN_SYSTEM_PROMPT.length + 'STATIC'.length + 'TASK'.length, 1)
      expect(expected).toBeGreaterThan(0.48) // the 24k output tokens alone are $0.48
      expect(r.estimatedUsd).toBeCloseTo(expected, 9)
      expect(r.costUsd).toBeCloseTo(expected, 9)
      expect(m.record).not.toHaveBeenCalled() // token_usage stays exact-only
      expect(r.stoppedReason).toBe('no_output')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[design-concept] aborted attempt — estimated cost $'))
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
      const r = await generateConcept(args({ costCapUsd: est / 2 }))
      expect(allowed).toEqual([true, false])
      expect(r.stoppedReason).toBe('cost_cap')
      expect(r.costUsd).toBeCloseTo(est, 9)
    })

    it('estimates an aborted repair with the repair’s own prompt and output budget', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      scripted = [{ concepts: [BROKEN] }]
      m.generateJson.mockImplementationOnce(async (opts: Opts) => {
        await opts.beforeAttempt?.(1)
        await opts.onAttempt?.(USAGE, 'stop')
        return scripted.shift()
      })
      m.generateJson.mockImplementationOnce(async (opts: Opts) => {
        await opts.beforeAttempt?.(1)
        return null // repair aborted
      })
      const r = await generateConcept(args())
      expect(r.concept).toBeNull()
      expect(r.estimatedUsd).toBeGreaterThan(0.32)
      expect(r.costUsd).toBeCloseTo(0.14 + r.estimatedUsd, 9)
    })

    it('does not estimate attempts that did report usage', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      scripted = [{ concepts: [BROKEN] }, { concepts: [B] }]
      const r = await generateConcept(args())
      expect(r.estimatedUsd).toBe(0)
      expect(r.costUsd).toBeCloseTo(0.28, 6)
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('aborted attempt'))
    })
  })
})
