import { describe, it, expect } from 'vitest'
import { summarize, byClient, dailySeries, type UsageRow } from './aggregate'

const SONNET = 'claude-sonnet-4-6' // $3/$15 per 1M in/out
const HAIKU = 'claude-haiku-4-5-20251001' // $1/$5 per 1M in/out

function row(over: Partial<UsageRow>): UsageRow {
  return {
    task: 'content',
    stage: 'content',
    model: SONNET,
    input_tokens: 0,
    output_tokens: 0,
    session_id: null,
    audit_id: null,
    created_at: '2026-06-17T00:00:00.000Z',
    ...over,
  }
}

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
