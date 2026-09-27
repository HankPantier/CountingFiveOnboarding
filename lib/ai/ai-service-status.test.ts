import { describe, it, expect, vi, beforeEach } from 'vitest'

// Queued supabase results: each terminal call pops the next one; writes are recorded.
const db = vi.hoisted(() => ({ results: [] as { data?: unknown; error?: { message: string } | null }[], upserts: [] as unknown[], selects: [] as string[] }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const q = {
        upsert: (row: unknown) => {
          db.upserts.push(row)
          return Promise.resolve(db.results.shift() ?? { error: null })
        },
        select: (cols: string) => {
          db.selects.push(cols)
          return q
        },
        eq: () => q,
        maybeSingle: () => Promise.resolve(db.results.shift() ?? { data: null, error: null }),
      }
      return q
    },
  }),
}))

import { isCreditRecent, CREDIT_STALE_MS, getAiCreditStatus, outageStatusFromRow, recordAiOutage } from './ai-service-status'

beforeEach(() => {
  db.results = []
  db.upserts = []
  db.selects = []
})

describe('isCreditRecent', () => {
  const now = 1_000_000_000_000
  const iso = (ms: number) => new Date(ms).toISOString()

  it('is false with no timestamp', () => {
    expect(isCreditRecent(null, now)).toBe(false)
    expect(isCreditRecent(undefined, now)).toBe(false)
  })

  it('is true for a failure inside the stale window', () => {
    expect(isCreditRecent(iso(now - 60_000), now)).toBe(true) // 1 min ago
    expect(isCreditRecent(iso(now - (CREDIT_STALE_MS - 1)), now)).toBe(true) // just inside
  })

  it('self-heals: false once the failure ages past the window', () => {
    expect(isCreditRecent(iso(now - CREDIT_STALE_MS - 1), now)).toBe(false)
    expect(isCreditRecent(iso(now - 60 * 60 * 1000), now)).toBe(false) // 1h ago
  })

  it('is false for a garbled timestamp', () => {
    expect(isCreditRecent('not-a-date', now)).toBe(false)
  })
})

describe('outageStatusFromRow', () => {
  const now = Date.parse('2026-09-26T12:00:00Z')
  const recent = new Date(now - 60_000).toISOString()
  it('a pre-080 row (no kind) reads as a credit outage', () => {
    expect(outageStatusFromRow({ credit_exhausted_at: recent }, now)).toEqual({ exhausted: true, since: recent, kind: 'credit', resetDate: null })
  })
  it('a usage-limit row carries its reset date', () => {
    expect(outageStatusFromRow({ credit_exhausted_at: recent, outage_kind: 'usage_limit', usage_limit_resets_on: '2026-10-01' }, now)).toEqual({
      exhausted: true,
      since: recent,
      kind: 'usage_limit',
      resetDate: '2026-10-01',
    })
  })
  it('a usage limit whose reset date has arrived is over, even inside the window', () => {
    const r = outageStatusFromRow({ credit_exhausted_at: recent, outage_kind: 'usage_limit', usage_limit_resets_on: '2026-09-26' }, now)
    expect(r.exhausted).toBe(false)
  })
  it('the self-heal window still applies', () => {
    const old = new Date(now - CREDIT_STALE_MS - 1).toISOString()
    expect(outageStatusFromRow({ credit_exhausted_at: old, outage_kind: 'usage_limit', usage_limit_resets_on: '2026-10-01' }, now).exhausted).toBe(false)
  })
})

describe('recordAiOutage', () => {
  it('writes the kind and the reset date', async () => {
    await recordAiOutage('usage_limit', '2026-10-01')
    expect(db.upserts).toEqual([expect.objectContaining({ id: true, outage_kind: 'usage_limit', usage_limit_resets_on: '2026-10-01', credit_exhausted_at: expect.any(String) })])
  })
  it('pre-080 (unknown column): a credit outage falls back to the 072 write', async () => {
    db.results = [{ error: { message: 'column "outage_kind" does not exist' } }, { error: null }]
    await recordAiOutage('credit')
    expect(db.upserts).toHaveLength(2)
    expect(db.upserts[1]).toEqual({ id: true, credit_exhausted_at: expect.any(String), updated_at: expect.any(String) })
  })
  it('pre-080: a usage limit is NOT mis-recorded as a credit outage', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.results = [{ error: { message: 'column "outage_kind" does not exist' } }]
    await recordAiOutage('usage_limit', '2026-10-01')
    expect(db.upserts).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('getAiCreditStatus', () => {
  it('reads kind + reset date', async () => {
    const at = new Date(Date.now() - 1000).toISOString()
    db.results = [{ data: { credit_exhausted_at: at, outage_kind: 'usage_limit', usage_limit_resets_on: '2999-01-01' }, error: null }]
    expect(await getAiCreditStatus()).toEqual({ exhausted: true, since: at, kind: 'usage_limit', resetDate: '2999-01-01' })
  })
  it('pre-080: falls back to the 072 read (credit)', async () => {
    const at = new Date(Date.now() - 1000).toISOString()
    db.results = [{ data: null, error: { message: 'column does not exist' } }, { data: { credit_exhausted_at: at }, error: null }]
    expect(await getAiCreditStatus()).toEqual({ exhausted: true, since: at, kind: 'credit', resetDate: null })
    expect(db.selects).toEqual(['credit_exhausted_at, outage_kind, usage_limit_resets_on', 'credit_exhausted_at'])
  })
  it('no row → not exhausted', async () => {
    db.results = [{ data: null, error: null }]
    expect(await getAiCreditStatus()).toEqual({ exhausted: false, since: null, kind: 'credit', resetDate: null })
  })
})
