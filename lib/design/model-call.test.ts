import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ generateJson: vi.fn(), record: vi.fn<(a: unknown) => Promise<void>>(async () => {}) }))
vi.mock('@/lib/content/json-generation', () => ({ generateJson: (o: unknown) => m.generateJson(o) }))
vi.mock('@/lib/content/token-usage', () => ({ recordTokenUsage: (a: unknown) => m.record(a) }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: (id: string) => ({ modelId: id }) }))

import { APICallError } from '@ai-sdk/provider'
import { attemptFailureReason, createDesignCaller, providerRejectionMessage, DEADLINE_SAFETY_MS, MIN_CALL_TIMEOUT_MS, estimateInputUsd, type DesignCallerOptions } from './model-call'

type Opts = {
  system?: string
  timeoutMs?: number
  beforeAttempt?: (n: 1 | 2) => boolean | Promise<boolean>
  onAttempt?: (usage: unknown, finish: string) => void | Promise<void>
  onAttemptFailed?: (info: { attempt: 1 | 2; finishReason: string; error: unknown }) => void
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

  it('prices and records an overridden model; estimateInputUsd defaults to DESIGN_MODEL pricing', async () => {
    m.generateJson.mockImplementation(async (o: Opts & { model: { modelId: string } }) => {
      expect(o.model.modelId).toBe('claude-fable-5-1')
      await o.beforeAttempt?.(1)
      await o.onAttempt?.(USAGE, 'stop')
      return { ok: 1 }
    })
    const caller = createDesignCaller(opts({ model: 'claude-fable-5-1' }))
    await caller.call(MSG, CFG)
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-fable-5-1' }))
    // Fable 5.1 at $10/$50: 10k in + 5k out = $0.35.
    expect(caller.spentUsd()).toBeCloseTo(0.35, 6)
    expect(estimateInputUsd('SYS', MSG, 'claude-fable-5-1')).toBeCloseTo(estimateInputUsd('SYS', MSG) * 2.5, 10)
  })
})

describe('per-attempt log', () => {
  it('logs each attempt’s duration and finish reason, and why a failed one failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let clock = NOW
    m.generateJson.mockImplementation(async (o: Opts) => {
      await o.beforeAttempt?.(1)
      clock += 180_000
      o.onAttemptFailed?.({ attempt: 1, finishReason: 'error', error: new DOMException('The operation was aborted due to timeout', 'TimeoutError') })
      await o.beforeAttempt?.(2)
      clock += 61_500
      await o.onAttempt?.(USAGE, 'length')
      o.onAttemptFailed?.({ attempt: 2, finishReason: 'length', error: new SyntaxError('bad json') })
      return null
    })
    const caller = createDesignCaller(opts({ logTag: 'design-concept', now: () => clock }))
    await caller.call(MSG, { ...CFG, retryBudget: 8_000 })
    const lines = warn.mock.calls.map((c) => String(c[0]))
    expect(lines).toContain('[design-concept] attempt 1 (claude-opus-5-5) failed after 180.0s — aborted (timeout)')
    expect(lines).toContain('[design-concept] attempt 2 (claude-opus-5-5) finished in 61.5s — finish=length, out=5000 tokens')
    expect(lines).toContain('[design-concept] attempt 2 (claude-opus-5-5) failed after 61.5s — unparseable output (finish=length)')
  })

  it('names a timeout abort, else the error, clipped', () => {
    expect(attemptFailureReason(new DOMException('x', 'AbortError'))).toBe('aborted (timeout)')
    expect(attemptFailureReason(new Error('socket hang up'))).toBe('Error: socket hang up')
    expect(attemptFailureReason('x'.repeat(500))).toHaveLength(200)
  })
})

const USAGE_LIMIT = 'You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC.'
const httpError = (statusCode: number | undefined, message: string) => new APICallError({ message, url: 'u', requestBodyValues: {}, statusCode, isRetryable: statusCode === undefined })

describe('provider errors', () => {
  it('adds NO estimate for an attempt the provider rejected with an HTTP error (usage limit), and stops the caller', async () => {
    m.generateJson.mockImplementation(async (o: Opts) => {
      await o.beforeAttempt?.(1)
      o.onAttemptFailed?.({ attempt: 1, finishReason: 'error', error: httpError(400, USAGE_LIMIT) })
      return null
    })
    const spends: number[] = []
    const caller = createDesignCaller(opts({ onSpend: (u) => spends.push(u) }))
    expect(await caller.call(MSG, CFG)).toBeNull()
    expect(caller.spentUsd()).toBe(0)
    expect(caller.estimatedUsd()).toBe(0)
    expect(spends).toEqual([])
    expect(caller.stopReason()).toBe('provider_rejected')
    expect(caller.rejection()).toEqual({ kind: 'usage_limit', resetDate: '2026-10-01' })
    // No repair turn / further call after an account-level rejection.
    expect(caller.plan(240_000)).toEqual({ ok: false, reason: 'provider_rejected' })
  })

  it('adds no estimate for a transient HTTP rejection (529) either, but does not stop the caller', async () => {
    m.generateJson.mockImplementation(async (o: Opts) => {
      await o.beforeAttempt?.(1)
      o.onAttemptFailed?.({ attempt: 1, finishReason: 'error', error: httpError(529, 'Overloaded') })
      return null
    })
    const caller = createDesignCaller(opts())
    await caller.call(MSG, CFG)
    expect(caller.spentUsd()).toBe(0)
    expect(caller.rejection()).toBeNull()
    expect(caller.plan(240_000).ok).toBe(true)
  })

  it('keeps the conservative estimate for a timeout abort and a status-less network failure', async () => {
    for (const error of [new DOMException('The operation was aborted due to timeout', 'TimeoutError'), httpError(undefined, 'Cannot connect to API: fetch failed')]) {
      m.generateJson.mockImplementation(async (o: Opts) => {
        await o.beforeAttempt?.(1)
        o.onAttemptFailed?.({ attempt: 1, finishReason: 'error', error })
        return null
      })
      const caller = createDesignCaller(opts())
      await caller.call(MSG, CFG)
      const expected = estimateInputUsd('SYS', MSG) + (8_000 / 1_000_000) * 20
      expect(caller.estimatedUsd()).toBeCloseTo(expected, 8)
    }
  })

  it('estimates only the aborted attempt when a rejected attempt came first', async () => {
    m.generateJson.mockImplementation(async (o: Opts) => {
      await o.beforeAttempt?.(1)
      o.onAttemptFailed?.({ attempt: 1, finishReason: 'error', error: httpError(529, 'Overloaded') })
      await o.beforeAttempt?.(2)
      o.onAttemptFailed?.({ attempt: 2, finishReason: 'error', error: new DOMException('x', 'TimeoutError') })
      return null
    })
    const caller = createDesignCaller(opts())
    await caller.call(MSG, { ...CFG, retryBudget: 12_000 })
    expect(caller.estimatedUsd()).toBeCloseTo(estimateInputUsd('SYS', MSG) + (12_000 / 1_000_000) * 20, 8)
  })

  it('words the Studio message per kind, with the reset date, never the key', () => {
    expect(providerRejectionMessage({ kind: 'usage_limit', resetDate: '2026-10-01' })).toBe(
      'The AI provider rejected the request: API usage limit reached (access returns 2026-10-01). Raise the limit in the Anthropic Console, then press Retry.'
    )
    expect(providerRejectionMessage({ kind: 'usage_limit', resetDate: null })).not.toContain('access returns')
    expect(providerRejectionMessage({ kind: 'auth', resetDate: null })).toContain('check ANTHROPIC_API_KEY')
    expect(providerRejectionMessage({ kind: 'credit', resetDate: null })).toContain('credits')
    expect(providerRejectionMessage({ kind: 'permission', resetDate: null })).toContain('permission')
  })
})
