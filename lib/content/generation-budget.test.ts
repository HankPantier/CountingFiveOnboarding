import { describe, expect, it } from 'vitest'
import {
  createBudget,
  runWithPool,
  classifyGenerationError,
  taggedError,
  isRetriableFailure,
  PER_CALL_CAP_MS,
  MIN_VIABLE_MS,
  RESERVE_MS,
} from './generation-budget'

// A controllable clock so these stay instant and deterministic.
function fakeClock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('createBudget', () => {
  it('reserves time for the completion check and chain fetch', () => {
    const c = fakeClock()
    const b = createBudget({ maxDurationMs: 600_000, now: c.now })
    expect(b.remaining()).toBe(600_000 - RESERVE_MS)
  })

  it('refuses to start a unit that cannot finish in the remaining budget', () => {
    const c = fakeClock()
    const b = createBudget({ maxDurationMs: 600_000, now: c.now })
    expect(b.canStart()).toBe(true)
    // Burn everything down to just under one viable unit.
    c.advance(600_000 - RESERVE_MS - MIN_VIABLE_MS + 1)
    expect(b.canStart()).toBe(false)
  })

  it('shrinks the per-call timeout as the deadline approaches', () => {
    const c = fakeClock()
    const b = createBudget({ maxDurationMs: 600_000, now: c.now })
    expect(b.callTimeout()).toBe(PER_CALL_CAP_MS) // capped while there is plenty left
    c.advance(600_000 - RESERVE_MS - 30_000) // 30s left
    expect(b.callTimeout()).toBe(30_000)
  })

  it('never returns a non-positive timeout, even past the deadline', () => {
    const c = fakeClock()
    const b = createBudget({ maxDurationMs: 600_000, now: c.now })
    c.advance(10_000_000)
    expect(b.callTimeout()).toBeGreaterThan(0)
  })
})

describe('runWithPool', () => {
  it('processes every item when the budget is ample', async () => {
    const c = fakeClock()
    const b = createBudget({ maxDurationMs: 600_000, now: c.now })
    const seen: number[] = []
    const { skipped } = await runWithPool([1, 2, 3, 4, 5], 3, b, async (n) => { seen.push(n) })
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5])
    expect(skipped).toEqual([])
  })

  it('stops and reports the remainder once the budget runs out', async () => {
    const c = fakeClock()
    const b = createBudget({ maxDurationMs: 600_000, now: c.now })
    const done: number[] = []
    // Each item eats 100s of the ~510s of usable budget.
    const { skipped } = await runWithPool([1, 2, 3, 4, 5, 6, 7, 8], 1, b, async (n) => {
      done.push(n)
      c.advance(100_000)
    })
    expect(done.length).toBeGreaterThan(0)
    expect(skipped.length).toBeGreaterThan(0)
    expect(done.length + skipped.length).toBe(8)
    // The whole point: it stopped deliberately rather than running past the cap.
    expect(b.remaining()).toBeGreaterThan(0)
  })

  it('never exceeds the requested concurrency', async () => {
    const b = createBudget({ maxDurationMs: 600_000 })
    let inFlight = 0
    let peak = 0
    await runWithPool([...Array(12).keys()], 3, b, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 1))
      inFlight--
    })
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('runs strictly one at a time at concurrency 1 (repo-commit safety)', async () => {
    const b = createBudget({ maxDurationMs: 600_000 })
    let inFlight = 0
    let peak = 0
    await runWithPool([1, 2, 3, 4], 1, b, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 1))
      inFlight--
    })
    expect(peak).toBe(1)
  })
})

describe('classifyGenerationError', () => {
  it('recognises an AbortSignal.timeout rejection', () => {
    const e = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })
    expect(classifyGenerationError(e)).toBe('timeout')
  })

  it('recognises provider overload and rate limiting by status code', () => {
    expect(classifyGenerationError({ statusCode: 529 })).toBe('provider_overload')
    expect(classifyGenerationError({ statusCode: 429 })).toBe('rate_limit')
  })

  it('recognises a JSON parse failure', () => {
    expect(classifyGenerationError(new SyntaxError('Unexpected token < in JSON at position 0')))
      .toBe('parse_failure')
  })

  it('falls back to unknown rather than guessing', () => {
    expect(classifyGenerationError(new Error('something odd'))).toBe('unknown')
  })

  it('tags the stored message so the kind is greppable without a migration', () => {
    expect(taggedError('timeout', 'worker stopped')).toBe('[timeout] worker stopped')
  })

  it('treats everything but a validation failure as worth retrying', () => {
    expect(isRetriableFailure('timeout')).toBe(true)
    expect(isRetriableFailure('provider_overload')).toBe(true)
    expect(isRetriableFailure('validation')).toBe(false)
  })
})
