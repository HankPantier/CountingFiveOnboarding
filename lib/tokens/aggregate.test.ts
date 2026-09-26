import { describe, it, expect } from 'vitest'
import { summarize, byClient, byUser, byUserClient, dailySeries, dailySeriesByUser, rowCost, usageWindowStartIso, modelTotalsCost, type UsageRow } from './aggregate'
import { estimateCostUsd } from '@/lib/content/token-pricing'

const SONNET = 'claude-sonnet-4-6' // $3/$15 per 1M in/out
const HAIKU = 'claude-haiku-4-5-20251001' // $1/$5 per 1M in/out

// Fixture rows carry the cost recordTokenUsage would have stored for an
// uncached call, unless a test pins cost_usd explicitly.
function row(over: Partial<UsageRow>): UsageRow {
  const base: UsageRow = {
    task: 'content',
    stage: 'content',
    model: SONNET,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: null,
    session_id: null,
    audit_id: null,
    created_by: null,
    created_at: '2026-06-17T00:00:00.000Z',
    ...over,
  }
  if (over.cost_usd === undefined) {
    base.cost_usd = estimateCostUsd(base.model, base.input_tokens, base.output_tokens)
  }
  return base
}

describe('rowCost', () => {
  it('uses the stored cache-aware cost_usd, not a re-price of raw input/output', () => {
    // 1M input of which 900k were cache reads: stored cost prices reads at 0.1x.
    const stored = estimateCostUsd(SONNET, 1_000_000, 0, 900_000, 0)
    const r = row({ input_tokens: 1_000_000, cost_usd: stored })
    expect(rowCost(r)).toBeCloseTo(stored, 9)
    expect(rowCost(r)).toBeLessThan(estimateCostUsd(SONNET, 1_000_000, 0))
    expect(summarize([r], NOW).allTime.cost).toBeCloseTo(stored, 9)
  })

  it('accepts numeric-as-string and treats null/garbage as 0', () => {
    expect(rowCost(row({ cost_usd: '1.250000' }))).toBeCloseTo(1.25, 9)
    expect(rowCost(row({ cost_usd: null, input_tokens: 5 }))).toBe(0)
    expect(rowCost(row({ cost_usd: 'NaN' }))).toBe(0)
  })
})

const NOW = Date.parse('2026-06-17T12:00:00.000Z')

describe('summarize', () => {
  it('splits all-time / last-30 / this-month and by model', () => {
    const rows: UsageRow[] = [
      // this month + last 30
      row({ model: SONNET, input_tokens: 1_000_000, output_tokens: 1_000_000, created_at: '2026-06-10T00:00:00Z' }),
      // older than 30 days, before this month
      row({ model: HAIKU, input_tokens: 1_000_000, output_tokens: 0, created_at: '2026-04-01T00:00:00Z' }),
    ]
    const s = summarize(rows, NOW)
    // Sonnet row: 3 + 15 = $18; Haiku row: $1
    expect(s.allTime.cost).toBeCloseTo(19, 6)
    expect(s.allTime.calls).toBe(2)
    expect(s.last30.cost).toBeCloseTo(18, 6)
    expect(s.thisMonth.cost).toBeCloseTo(18, 6)
    expect(s.byModel[SONNET].cost).toBeCloseTo(18, 6)
    expect(s.byModel[HAIKU].cost).toBeCloseTo(1, 6)
  })

  it('splits all-time totals by task', () => {
    const rows: UsageRow[] = [
      row({ task: 'onboarding', input_tokens: 1_000_000 }), // $3
      row({ task: 'audit', input_tokens: 1_000_000 }), // $3
      row({ task: 'content', input_tokens: 1_000_000, output_tokens: 1_000_000 }), // $18
    ]
    const s = summarize(rows, NOW)
    expect(s.byTask.onboarding.cost).toBeCloseTo(3, 6)
    expect(s.byTask.audit.cost).toBeCloseTo(3, 6)
    expect(s.byTask.content.cost).toBeCloseTo(18, 6)
    expect(s.byTask.audit.calls).toBe(1)
  })
})

describe('byClient', () => {
  it('rolls up by session and collapses session-less rows into Unassigned', () => {
    const rows: UsageRow[] = [
      row({ session_id: 's1', task: 'onboarding', input_tokens: 1_000_000 }), // $3
      row({ session_id: 's1', task: 'content', model: HAIKU, output_tokens: 1_000_000 }), // $5
      row({ session_id: null, audit_id: 'a1', task: 'audit', input_tokens: 1_000_000 }), // $3, unassigned
    ]
    const clients = byClient(rows, { s1: 'example.com' })
    expect(clients).toHaveLength(2)
    // sorted by cost desc → s1 ($8) first
    expect(clients[0].label).toBe('example.com')
    expect(clients[0].total.cost).toBeCloseTo(8, 6)
    expect(clients[0].byTask.onboarding.cost).toBeCloseTo(3, 6)
    expect(clients[0].byTask.content.cost).toBeCloseTo(5, 6)
    const unassigned = clients[1]
    expect(unassigned.clientId).toBeNull()
    expect(unassigned.label).toBe('Unassigned / System')
    expect(unassigned.byTask.audit.cost).toBeCloseTo(3, 6)
  })

  it('attributes an audit row to its linked session via the audits map', () => {
    const rows: UsageRow[] = [
      row({ session_id: 's1', task: 'onboarding', input_tokens: 1_000_000 }), // $3
      row({ session_id: null, audit_id: 'a1', task: 'audit', input_tokens: 1_000_000 }), // $3 → s1
    ]
    const clients = byClient(
      rows,
      { s1: 'example.com' },
      { a1: { sessionId: 's1', siteName: 'Example', domain: 'example.com' } }
    )
    expect(clients).toHaveLength(1)
    expect(clients[0].clientId).toBe('s1')
    expect(clients[0].kind).toBe('session')
    expect(clients[0].total.cost).toBeCloseTo(6, 6)
    expect(clients[0].byTask.audit.cost).toBeCloseTo(3, 6)
    expect(clients[0].byTask.onboarding.cost).toBeCloseTo(3, 6)
  })

  it('buckets a session-less audit by its audited site', () => {
    const rows: UsageRow[] = [
      row({ session_id: null, audit_id: 'a2', task: 'audit', input_tokens: 1_000_000 }), // $3
    ]
    const clients = byClient(
      rows,
      {},
      { a2: { sessionId: null, siteName: 'BBL CPAs', domain: 'bblcpa.com' } }
    )
    expect(clients).toHaveLength(1)
    expect(clients[0].kind).toBe('audit-site')
    expect(clients[0].clientId).toBe('audit:bblcpa.com')
    expect(clients[0].label).toBe('BBL CPAs')
    expect(clients[0].byTask.audit.cost).toBeCloseTo(3, 6)
  })
})

describe('byUser', () => {
  it('splits by created_by, sub-splits by task/model, sorts by cost desc', () => {
    const rows: UsageRow[] = [
      row({ created_by: 'u1', task: 'onboarding', input_tokens: 1_000_000 }), // $3
      row({ created_by: 'u1', task: 'content', output_tokens: 1_000_000 }), // $15
      row({ created_by: 'u2', task: 'audit', model: HAIKU, input_tokens: 1_000_000 }), // $1
    ]
    const users = byUser(rows, { u1: 'Alice', u2: 'Bob' })
    expect(users).toHaveLength(2)
    // u1 ($18) sorts before u2 ($1)
    expect(users[0].userId).toBe('u1')
    expect(users[0].label).toBe('Alice')
    expect(users[0].total.cost).toBeCloseTo(18, 6)
    expect(users[0].byTask.onboarding.cost).toBeCloseTo(3, 6)
    expect(users[0].byTask.content.cost).toBeCloseTo(15, 6)
    expect(users[0].byModel[SONNET].cost).toBeCloseTo(18, 6)
    expect(users[1].byModel[HAIKU].cost).toBeCloseTo(1, 6)
  })

  it('collapses rows with no actor into a single Unattributed bucket', () => {
    const rows: UsageRow[] = [
      row({ created_by: null, input_tokens: 1_000_000 }), // $3
      row({ created_by: null, input_tokens: 1_000_000 }), // $3
    ]
    const users = byUser(rows, {})
    expect(users).toHaveLength(1)
    expect(users[0].userId).toBeNull()
    expect(users[0].label).toBe('Unattributed')
    expect(users[0].total.calls).toBe(2)
    expect(users[0].total.cost).toBeCloseTo(6, 6)
  })

  it('falls back to the raw id when the label map has no entry', () => {
    const users = byUser([row({ created_by: 'u9', input_tokens: 1_000_000 })], {})
    expect(users[0].label).toBe('u9')
  })
})

describe('byUserClient', () => {
  it('builds a user × client matrix reusing the client-bucket resolution', () => {
    const rows: UsageRow[] = [
      row({ created_by: 'u1', session_id: 's1', input_tokens: 1_000_000 }), // $3 → Alice/s1
      row({ created_by: 'u1', session_id: 's2', input_tokens: 1_000_000 }), // $3 → Alice/s2
      row({ created_by: null, session_id: null, audit_id: 'a2', task: 'audit', input_tokens: 1_000_000 }), // $3 → Unattributed/audit-site
    ]
    const matrix = byUserClient(
      rows,
      { u1: 'Alice' },
      { s1: 'one.com', s2: 'two.com' },
      { a2: { sessionId: null, siteName: 'BBL', domain: 'bbl.com' } }
    )
    expect(matrix).toHaveLength(2)
    // Alice ($6 across two clients) sorts before Unattributed ($3)
    const alice = matrix[0]
    expect(alice.userId).toBe('u1')
    expect(alice.total.cost).toBeCloseTo(6, 6)
    expect(alice.clients).toHaveLength(2)
    expect(alice.clients.map((c) => c.clientLabel).sort()).toEqual(['one.com', 'two.com'])

    const unattributed = matrix[1]
    expect(unattributed.userId).toBeNull()
    expect(unattributed.label).toBe('Unattributed')
    expect(unattributed.clients).toHaveLength(1)
    expect(unattributed.clients[0].clientKind).toBe('audit-site')
    expect(unattributed.clients[0].clientLabel).toBe('BBL')
  })
})

describe('dailySeriesByUser', () => {
  it('returns one ascending-by-date series per user', () => {
    const rows: UsageRow[] = [
      row({ created_by: 'u1', created_at: '2026-06-15T00:00:00Z', input_tokens: 1_000_000 }), // $3
      row({ created_by: 'u1', created_at: '2026-06-14T00:00:00Z', input_tokens: 1_000_000 }), // $3
      row({ created_by: 'u2', created_at: '2026-06-15T00:00:00Z', input_tokens: 1_000_000 }), // $3
    ]
    const series = dailySeriesByUser(rows, { u1: 'Alice', u2: 'Bob' })
    expect(series.map((s) => s.label).sort()).toEqual(['Alice', 'Bob'])
    const alice = series.find((s) => s.key === 'u1')!
    expect(alice.points.map((p) => p.date)).toEqual(['2026-06-14', '2026-06-15'])
    expect(alice.points[0].cost).toBeCloseTo(3, 6)
  })

  it('folds users beyond topN into a single Other series', () => {
    const rows: UsageRow[] = [
      row({ created_by: 'u1', input_tokens: 3_000_000 }), // $9 — rank 1
      row({ created_by: 'u2', input_tokens: 2_000_000 }), // $6 — rank 2
      row({ created_by: 'u3', input_tokens: 1_000_000 }), // $3 — folds to Other
      row({ created_by: 'u4', input_tokens: 1_000_000 }), // $3 — folds to Other
    ]
    const series = dailySeriesByUser(rows, {}, 2)
    expect(series).toHaveLength(3)
    const other = series.find((s) => s.key === '__other__')!
    expect(other.label).toBe('Other')
    // u3 + u4 same day → merged point of $6
    expect(other.points).toHaveLength(1)
    expect(other.points[0].cost).toBeCloseTo(6, 6)
  })
})

describe('dailySeries', () => {
  it('buckets by UTC date ascending and filters by task', () => {
    const rows: UsageRow[] = [
      row({ created_at: '2026-06-15T03:00:00Z', task: 'audit', input_tokens: 1_000_000 }),
      row({ created_at: '2026-06-15T20:00:00Z', task: 'content', input_tokens: 1_000_000 }),
      row({ created_at: '2026-06-14T10:00:00Z', task: 'content', input_tokens: 1_000_000 }),
    ]
    const all = dailySeries(rows)
    expect(all.map((p) => p.date)).toEqual(['2026-06-14', '2026-06-15'])
    const content = dailySeries(rows, 'content')
    expect(content).toHaveLength(2)
    const audit = dailySeries(rows, 'audit')
    expect(audit).toHaveLength(1)
    expect(audit[0].date).toBe('2026-06-15')
  })
})

describe('usageWindowStartIso', () => {
  it('matches summarize window boundaries', () => {
    expect(usageWindowStartIso('allTime', NOW)).toBeNull()
    expect(usageWindowStartIso('thisMonth', NOW)).toBe('2026-06-01T00:00:00.000Z')
    expect(usageWindowStartIso('last30', NOW)).toBe('2026-05-18T12:00:00.000Z')
  })
})

describe('modelTotalsCost', () => {
  it('sums the RPC cost_usd when present (post-079)', () => {
    expect(
      modelTotalsCost([
        { model: SONNET, input_tokens: 1_000_000, output_tokens: 0, cost_usd: '0.4' },
        { model: HAIKU, input_tokens: 0, output_tokens: 0, cost_usd: 0.1 },
      ]),
    ).toBeCloseTo(0.5, 9)
  })

  it('falls back to re-pricing tokens when the RPC predates 079', () => {
    expect(modelTotalsCost([{ model: SONNET, input_tokens: 1_000_000, output_tokens: 1_000_000 }])).toBeCloseTo(18, 6)
    expect(modelTotalsCost(null)).toBe(0)
  })
})
