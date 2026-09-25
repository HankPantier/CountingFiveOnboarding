import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ generateJson: vi.fn(), record: vi.fn<(a: unknown) => Promise<void>>(async () => {}) }))
vi.mock('@/lib/content/json-generation', () => ({ generateJson: (o: unknown) => m.generateJson(o) }))
vi.mock('@/lib/content/token-usage', () => ({ recordTokenUsage: (a: unknown) => m.record(a) }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: (id: string) => ({ modelId: id }) }))

import { createDesignCaller, DEADLINE_SAFETY_MS, MIN_CALL_TIMEOUT_MS, estimateInputUsd, type DesignCallerOptions } from './model-call'

type Opts = {
  system?: string
  timeoutMs?: number
  beforeAttempt?: (n: 1 | 2) => boolean | Promise<boolean>
  onAttempt?: (usage: unknown, finish: string) => void | Promise<void>
  [k: string]: unknown
}
const USAGE = { inputTokens: 10_000, outputTokens: 5_000, inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 } }
const NOW = 1_000_000
const MSG = [{ role: 'user' as const, content: 'hello' }]
const CFG = { firstBudget: 8_000, label: 't', capMs: 240_000 }
const opts = (over: Partial<DesignCallerOptions> = {}): DesignCallerOptions => ({
  stage: 'design_critique',
  system: 'SYS',
  logTag: 'design-critique',
  costSoFarUsd: 0,
  costCapUsd: 4,
  deadline: NOW + 540_000,
  attribution: { sessionId: 's', contentJobId: 'j', createdBy: 'a' },
  now: () => NOW,
  ...over,
})

beforeEach(() => {
  m.record.mockClear()
  m.generateJson.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('createDesignCaller', () => {
  it('records exact usage under the caller’s stage and reports the running spend', async () => {
    m.generateJson.mockImplementation(async (o: Opts) => {
      expect(await o.beforeAttempt?.(1)).toBe(true)
      await o.onAttempt?.(USAGE, 'stop')
      return { ok: 1 }
    })
    const spends: number[] = []
    const caller = createDesignCaller(opts({ onSpend: (u) => spends.push(u) }))
    expect(await caller.call(MSG, CFG)).toEqual({ ok: 1 })
    expect(m.record).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'content', stage: 'design_critique', model: 'claude-opus-5-5', inputTokens: 10_000, outputTokens: 5_000, cacheTtl: '5m' })
    )
    // Opus 5.5 at $4/$20: 10k in + 5k out = $0.14.
    expect(caller.spentUsd()).toBeCloseTo(0.14, 6)
    expect(spends.at(-1)).toBeCloseTo(0.14, 6)
    expect(caller.estimatedUsd()).toBe(0)
    expect(caller.stopReason()).toBeNull()
  })

  it('passes the system prompt and gives the attempt min(cap, deadline − now − safety)', async () => {
    let seen: Opts | null = null
    m.generateJson.mockImplementation(async (o: Opts) => {
      await o.beforeAttempt?.(1)
      seen = o
      return null
    })
    const caller = createDesignCaller(opts({ deadline: NOW + 200_000 }))
    await caller.call(MSG, CFG)
    const o = seen as unknown as Opts
    expect(o.system).toBe('SYS')
    expect(o.timeoutMs).toBe(200_000 - DEADLINE_SAFETY_MS)
    for (const k of ['temperature', 'topP', 'topK', 'toolChoice']) expect(k in o).toBe(false)
  })

  it('vetoes an attempt at the cost cap and remembers why', async () => {
    m.generateJson.mockImplementation(async (o: Opts) => ((await o.beforeAttempt?.(1)) ? { ok: 1 } : null))
    const caller = createDesignCaller(opts({ costSoFarUsd: 4 }))
    expect(await caller.call(MSG, CFG)).toBeNull()
    expect(caller.stopReason()).toBe('cost_cap')
    expect(m.record).not.toHaveBeenCalled()
  })

  it('vetoes an attempt when less than MIN_CALL_TIMEOUT_MS would be left', async () => {
    m.generateJson.mockImplementation(async (o: Opts) => ((await o.beforeAttempt?.(1)) ? { ok: 1 } : null))
    const caller = createDesignCaller(opts({ deadline: NOW + DEADLINE_SAFETY_MS + MIN_CALL_TIMEOUT_MS - 1 }))
    expect(await caller.call(MSG, CFG)).toBeNull()
    expect(caller.stopReason()).toBe('deadline')
  })

  it('charges an estimate (input + full max output) for an attempt that never reported usage', async () => {
    m.generateJson.mockImplementation(async (o: Opts) => {
      await o.beforeAttempt?.(1) // started, then aborted: no onAttempt
      return null
    })
    const caller = createDesignCaller(opts())
    await caller.call(MSG, CFG)
    const expected = estimateInputUsd('SYS', MSG) + (8_000 / 1_000_000) * 20
    expect(caller.estimatedUsd()).toBeCloseTo(expected, 8)
    expect(caller.spentUsd()).toBeCloseTo(expected, 8)
    expect(m.record).not.toHaveBeenCalled()
  })
})
