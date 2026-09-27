import { describe, expect, it } from 'vitest'
import { pool, verifyRepo, type VerifyStep } from './verify'

describe('verifyRepo', () => {
  it('retries a flaky repo once (the Google-Fonts build flake) and reports the attempt', async () => {
    let builds = 0
    const runner = async (step: VerifyStep) => {
      if (step.name === 'build' && builds++ === 0) return { code: 1, output: 'Failed to fetch font `Inter`' }
      return { code: 0, output: '' }
    }
    const r = await verifyRepo('/nonexistent', { runner })
    expect(r).toMatchObject({ ok: true, attempts: 2, passed: ['ci', 'tsc', 'test', 'build'] })
  })

  it('fails after the retry with the failing step and output tail', async () => {
    const r = await verifyRepo('/nonexistent', { runner: async (s) => (s.name === 'tsc' ? { code: 2, output: 'TS2322 boom' } : { code: 0, output: '' }) })
    expect(r).toMatchObject({ ok: false, attempts: 2, failedStep: 'tsc', passed: ['ci'] })
    expect(r.tail).toContain('TS2322')
  })
})

describe('pool', () => {
  it('never runs more than `limit` at once and keeps order', async () => {
    let live = 0
    let peak = 0
    const out = await pool([5, 1, 4, 2, 3], 2, async (n) => {
      live++
      peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, n))
      live--
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30])
    expect(peak).toBe(2)
  })
})
