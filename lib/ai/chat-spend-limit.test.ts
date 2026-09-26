import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import {
  CHAT_SPEND_LIMITS,
  checkChatSpendLimit,
  evaluateSpend,
  spendTierFor,
} from './chat-spend-limit'
import type { CurrentUser } from '@/lib/auth/access'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(), createAuthClient: vi.fn() }))

const NOW = Date.parse('2026-09-25T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000

const admin: CurrentUser = { id: 'a', role: 'admin', isAdmin: true, capabilities: [] }
const owner: CurrentUser = { id: 'o', role: 'member', isAdmin: false, capabilities: ['owner'] }
const manager: CurrentUser = { id: 'm', role: 'member', isAdmin: false, capabilities: ['manager'] }

describe('spendTierFor', () => {
  it('maps admins, Site Owners and other members to their tiers', () => {
    expect(spendTierFor(admin)).toBe('admin')
    expect(spendTierFor(owner)).toBe('owner')
    expect(spendTierFor(manager)).toBe('member')
    expect(CHAT_SPEND_LIMITS.owner.hourUsd).toBeLessThan(CHAT_SPEND_LIMITS.admin.hourUsd)
  })
})

describe('evaluateSpend', () => {
  const limit = { hourUsd: 3, dayUsd: 10 }

  it('allows spend under both ceilings', () => {
    expect(evaluateSpend([{ cost_usd: 1, created_at: ago(10 * MIN) }], limit, NOW)).toEqual({ allowed: true })
  })

  it('blocks on the rolling hour', () => {
    const rows = [
      { cost_usd: 2, created_at: ago(5 * MIN) },
      { cost_usd: '1.5', created_at: ago(50 * MIN) },
    ]
    expect(evaluateSpend(rows, limit, NOW)).toEqual({ allowed: false, window: 'hour' })
  })

  it('lets older spend age out of the hour but still counts it for the day', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ cost_usd: 2, created_at: ago((2 + i) * 60 * MIN) }))
    expect(evaluateSpend(rows, limit, NOW)).toEqual({ allowed: false, window: 'day' })
    expect(evaluateSpend(rows.slice(0, 4), limit, NOW)).toEqual({ allowed: true })
  })

  it('ignores rows older than a day and junk costs', () => {
    const rows = [
      { cost_usd: 50, created_at: ago(25 * 60 * MIN) },
      { cost_usd: null, created_at: ago(MIN) },
    ]
    expect(evaluateSpend(rows, limit, NOW)).toEqual({ allowed: true })
  })
})

describe('checkChatSpendLimit', () => {
  function db(rows: Array<{ cost_usd: number; created_at: string }> | null, error: { message: string } | null = null) {
    const calls: Array<[string, unknown]> = []
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { calls.push([c, v]); return b },
      in: (c: string, v: unknown) => { calls.push([c, v]); return b },
      gte: async () => ({ data: rows, error }),
    }
    return { client: { from: () => b } as unknown as Parameters<typeof checkChatSpendLimit>[0], calls }
  }

  it('returns a 429 for a Site Owner over the owner ceiling but not for an admin with the same spend', async () => {
    const rows = [{ cost_usd: 4, created_at: new Date(Date.now() - 5 * MIN).toISOString() }]
    const blocked = await checkChatSpendLimit(db(rows).client, owner)
    expect(blocked).toBeInstanceOf(NextResponse)
    expect(blocked?.status).toBe(429)
    expect(((await blocked!.json()) as { error: string }).error).toMatch(/AI editing limit/)
    expect(await checkChatSpendLimit(db(rows).client, admin)).toBeNull()
  })

  it('scopes the query to the user and the editor stages, and fails open on a read error', async () => {
    const d = db([])
    await checkChatSpendLimit(d.client, owner)
    expect(d.calls).toContainEqual(['created_by', 'o'])
    expect(d.calls).toContainEqual(['stage', ['content_edit', 'site_structure_edit']])
    expect(await checkChatSpendLimit(db(null, { message: 'boom' }).client, owner)).toBeNull()
  })
})

describe('AI editor routes', () => {
  it.each(['app/api/edit/[id]/chat/route.ts', 'app/api/edit/[id]/site-assistant/chat/route.ts'])(
    '%s checks the spend ceiling before calling the model',
    (file) => {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
      const check = src.indexOf('await checkChatSpendLimit(supabase, user)')
      expect(check).toBeGreaterThan(-1)
      expect(check).toBeLessThan(src.indexOf('streamText({'))
    }
  )
})
