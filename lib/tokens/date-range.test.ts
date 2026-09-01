import { describe, it, expect } from 'vitest'
import { resolveDateRange } from './date-range'

// 2026-06-17T12:00:00Z — a Wednesday mid-month, mid-year.
const NOW = Date.parse('2026-06-17T12:00:00.000Z')

describe('resolveDateRange', () => {
  it('defaults to All time (unbounded) for missing or unknown ranges', () => {
    for (const params of [{}, { range: 'nonsense' }]) {
      const r = resolveDateRange(params, NOW)
      expect(r.key).toBe('all')
      expect(r.fromISO).toBeUndefined()
      expect(r.toISO).toBeUndefined()
      expect(r.label).toBe('All time')
    }
  })

  it('30d / 90d look back N days from now', () => {
    const r30 = resolveDateRange({ range: '30d' }, NOW)
    expect(r30.label).toBe('Last 30 days')
    expect(r30.fromISO).toBe(new Date(NOW - 30 * 86400000).toISOString())
    expect(r30.toISO).toBe(new Date(NOW).toISOString())

    const r90 = resolveDateRange({ range: '90d' }, NOW)
    expect(r90.fromISO).toBe(new Date(NOW - 90 * 86400000).toISOString())
  })

  it('mtd starts at the first of the current UTC month', () => {
    const r = resolveDateRange({ range: 'mtd' }, NOW)
    expect(r.label).toBe('This month')
    expect(r.fromISO).toBe('2026-06-01T00:00:00.000Z')
  })

  it('ytd starts at Jan 1 of the current UTC year', () => {
    const r = resolveDateRange({ range: 'ytd' }, NOW)
    expect(r.fromISO).toBe('2026-01-01T00:00:00.000Z')
  })

  it('custom uses inclusive day bounds and echoes raw inputs', () => {
    const r = resolveDateRange({ range: 'custom', from: '2026-05-01', to: '2026-05-31' }, NOW)
    expect(r.key).toBe('custom')
    expect(r.fromISO).toBe('2026-05-01T00:00:00.000Z')
    expect(r.toISO).toBe('2026-05-31T23:59:59.999Z')
    expect(r.from).toBe('2026-05-01')
    expect(r.to).toBe('2026-05-31')
    expect(r.label).toBe('2026-05-01 → 2026-05-31')
  })

  it('custom tolerates a one-sided or malformed window', () => {
    expect(resolveDateRange({ range: 'custom', from: '2026-05-01' }, NOW).toISO).toBeUndefined()
    const bad = resolveDateRange({ range: 'custom', from: 'nope', to: '2026/05/31' }, NOW)
    expect(bad.fromISO).toBeUndefined()
    expect(bad.toISO).toBeUndefined()
    expect(bad.label).toBe('Custom')
  })
})
