import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from './__fixtures__/fake-supabase'
import {
  DEAD_RUN_RENDER_MIN_AGE_MS,
  DESIGN_ORPHAN_MIN_AGE_MS,
  MAX_REMOVALS_PER_SWEEP,
  MAX_SESSIONS_PER_SWEEP,
  isStorageSweepSlot,
  sessionSlice,
  sweepDeadRunRenders,
  sweepDesignStorageOrphans,
  designStorageSweepDeps,
  type DeadRun,
  type OrphanSweepDeps,
  type StorageEntry,
} from './storage-sweep'

const NOW = Date.parse('2026-09-25T12:02:00.000Z')
const OLD = new Date(NOW - DESIGN_ORPHAN_MIN_AGE_MS - 1000).toISOString()
const NEW = new Date(NOW - 60_000).toISOString()
const SID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const A_SENT = '11111111-1111-4111-8111-111111111111'
const A_UNSENT = '22222222-2222-4222-8222-222222222222'
const A_FRESH = '33333333-3333-4333-8333-333333333333'
const RUN = '44444444-4444-4444-8444-444444444444'

function deps(tree: Record<string, StorageEntry[]>, referenced: string[], over: Partial<OrphanSweepDeps> = {}) {
  const removed: string[][] = []
  const swept: string[] = []
  const d: OrphanSweepDeps = {
    list: async (prefix, offset) => (offset === 0 ? (tree[prefix] ?? []) : []),
    remove: async (paths) => {
      removed.push(paths)
    },
    referencedAttachmentIds: async () => new Set(referenced),
    listDeadRuns: async () => [],
    versionPaths: async () => new Set(),
    markRunSwept: async (run) => {
      swept.push(run.id)
      return true
    },
    ...over,
  }
  return { d, removed, swept }
}

describe('sweepDesignStorageOrphans', () => {
  it('drops old /design/render outputs and unsent attachments, never chat previews or referenced/fresh files', async () => {
    const referenced = vi.fn(async () => new Set([A_SENT]))
    const { d, removed } = deps(
      {
        design: [{ name: SID, id: null }, { name: 'not-a-session', id: null }],
        [`design/${SID}/renders`]: [
          { name: 'chat', id: null },
          { name: 'aaaa-desktop-0.webp', id: 'f1', created_at: OLD },
          { name: 'bbbb-desktop-0.webp', id: 'f2', created_at: NEW },
        ],
        [`design/${SID}/attachments`]: [
          { name: `${A_SENT}.webp`, id: 'f3', created_at: OLD },
          { name: `${A_UNSENT}.webp`, id: 'f4', created_at: OLD },
          { name: `${A_FRESH}.webp`, id: 'f5', created_at: NEW },
        ],
      },
      [],
      { referencedAttachmentIds: referenced }
    )
    expect(await sweepDesignStorageOrphans(d, NOW)).toEqual({ renders: 1, attachments: 1, runRenders: 0 })
    expect(removed.flat()).toEqual([`design/${SID}/renders/aaaa-desktop-0.webp`, `design/${SID}/attachments/${A_UNSENT}.webp`])
    // One reference query per session, not per attachment.
    expect(referenced).toHaveBeenCalledTimes(1)
    expect(referenced).toHaveBeenCalledWith(SID)
  })

  it('is idempotent: a second pass over the swept tree removes nothing', async () => {
    const tree: Record<string, StorageEntry[]> = {
      design: [{ name: SID, id: null }],
      [`design/${SID}/renders`]: [{ name: 'aaaa-desktop-0.webp', id: 'f1', created_at: OLD }],
    }
    const { d } = deps(tree, [], {
      remove: async (paths) => {
        tree[`design/${SID}/renders`] = tree[`design/${SID}/renders`].filter((e) => !paths.includes(`design/${SID}/renders/${e.name}`))
      },
    })
    expect((await sweepDesignStorageOrphans(d, NOW)).renders).toBe(1)
    expect((await sweepDesignStorageOrphans(d, NOW)).renders).toBe(0)
  })

  it('caps removals per invocation', async () => {
    const many = Array.from({ length: MAX_REMOVALS_PER_SWEEP + 50 }, (_, i) => ({ name: `r${i}-desktop-0.webp`, id: `f${i}`, created_at: OLD }))
    const { d, removed } = deps({ design: [{ name: SID, id: null }], [`design/${SID}/renders`]: many }, [])
    const out = await sweepDesignStorageOrphans(d, NOW)
    expect(out.renders).toBe(MAX_REMOVALS_PER_SWEEP)
    expect(removed.flat()).toHaveLength(MAX_REMOVALS_PER_SWEEP)
  })

  it('never throws: a listing failure logs and returns zero', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { d } = deps({}, [], {
      list: async () => {
        throw new Error('storage down')
      },
    })
    expect(await sweepDesignStorageOrphans(d, NOW)).toEqual({ renders: 0, attachments: 0, runRenders: 0 })
    err.mockRestore()
  })

  it('runs in one 5-minute slot per hour', () => {
    expect(isStorageSweepSlot(Date.parse('2026-09-25T12:03:00Z'))).toBe(true)
    expect(isStorageSweepSlot(Date.parse('2026-09-25T12:07:00Z'))).toBe(false)
  })
})

describe('sessionSlice', () => {
  it('visits every session within ceil(n / MAX) hours, MAX at a time', () => {
    const all = Array.from({ length: MAX_SESSIONS_PER_SWEEP * 2 + 5 }, (_, i) => `s${i}`)
    const seen = new Set<string>()
    const hours = Math.ceil(all.length / MAX_SESSIONS_PER_SWEEP)
    for (let h = 0; h < hours; h++) {
      const slice = sessionSlice(all, h * 3_600_000)
      expect(slice).toHaveLength(MAX_SESSIONS_PER_SWEEP)
      slice.forEach((s) => seen.add(s))
    }
    expect(seen.size).toBe(all.length)
  })
  it('a small bucket is swept whole every time', () => {
    expect(sessionSlice(['a', 'b'], NOW)).toEqual(['a', 'b'])
  })
})

describe('sweepDeadRunRenders', () => {
  const dead: DeadRun = { id: RUN, sessionId: SID, status: 'error', updatedAt: '2026-09-01T00:00:00Z', baseSnapshot: { pagePath: '/' } }
  const prefix = `design/${SID}/runs/${RUN}`

  it('empties a week-old failed/cancelled run folder except version thumbnails, then stamps the run', async () => {
    const listDeadRuns = vi.fn(async () => [dead])
    const { d, removed, swept } = deps(
      {
        [prefix]: [
          { name: 'current-desktop.webp', id: 'a' },
          { name: 'concept-0-r0-desktop.webp', id: 'b' },
          { name: 'concept-1-r1-desktop.webp', id: 'c' },
        ],
      },
      [],
      { listDeadRuns, versionPaths: async () => new Set([`${prefix}/concept-1-r1-desktop.webp`]) }
    )
    expect(await sweepDeadRunRenders(d, NOW)).toBe(2)
    expect(removed.flat()).toEqual([`${prefix}/current-desktop.webp`, `${prefix}/concept-0-r0-desktop.webp`])
    expect(swept).toEqual([RUN])
    const [cutoff, limit] = listDeadRuns.mock.calls[0] as unknown as [string, number]
    expect(Date.parse(cutoff)).toBe(NOW - DEAD_RUN_RENDER_MIN_AGE_MS)
    expect(limit).toBeGreaterThan(0)
  })

  it('an already-empty folder is only stamped (no remove call)', async () => {
    const { d, removed, swept } = deps({}, [], { listDeadRuns: async () => [dead] })
    expect(await sweepDeadRunRenders(d, NOW)).toBe(0)
    expect(removed).toEqual([])
    expect(swept).toEqual([RUN])
  })

  it('a partly emptied folder (budget hit) is not stamped, so the next pass finishes it', async () => {
    const { d, swept } = deps({ [prefix]: [{ name: 'a.webp', id: 'a' }, { name: 'b.webp', id: 'b' }] }, [], { listDeadRuns: async () => [dead] })
    expect(await sweepDeadRunRenders(d, NOW, 1)).toBe(1)
    expect(swept).toEqual([])
  })

  it('skips a run with a malformed id and never throws on a listing failure', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = deps({}, [], { listDeadRuns: async () => [{ ...dead, sessionId: '../x' }] })
    expect(await sweepDeadRunRenders(bad.d, NOW)).toBe(0)
    expect(bad.swept).toEqual([])
    const down = deps({}, [], {
      listDeadRuns: async () => {
        throw new Error('db down')
      },
    })
    expect(await sweepDeadRunRenders(down.d, NOW)).toBe(0)
    err.mockRestore()
  })
})

describe('designStorageSweepDeps (service-role queries)', () => {
  it('lists only unswept error/cancelled runs older than the cutoff, oldest first, bounded', async () => {
    const f = fakeSupabase({ design_runs: [{ data: [{ id: RUN, session_id: SID, status: 'error', updated_at: 'u', base_snapshot: null }] }] })
    const runs = await designStorageSweepDeps(f.client).listDeadRuns('2026-09-18T00:00:00Z', 10)
    expect(runs).toEqual([{ id: RUN, sessionId: SID, status: 'error', updatedAt: 'u', baseSnapshot: null }])
    const ops = f.opsFor('design_runs')
    expect(ops).toContainEqual(['in', 'status', ['error', 'cancelled']])
    expect(ops).toContainEqual(['lt', 'updated_at', '2026-09-18T00:00:00Z'])
    expect(ops).toContainEqual(['is', 'base_snapshot->>rendersSweptAt', null])
    expect(ops).toContainEqual(['limit', 10])
  })
  it('stamps a run with a CAS on status + updated_at, keeping its snapshot and NOT bumping updated_at', async () => {
    const f = fakeSupabase({ design_runs: [{ data: [{ id: RUN }] }] })
    const ok = await designStorageSweepDeps(f.client).markRunSwept(
      { id: RUN, sessionId: SID, status: 'cancelled', updatedAt: 'u1', baseSnapshot: { pagePath: '/x' } },
      '2026-09-25T12:02:00.000Z'
    )
    expect(ok).toBe(true)
    const ops = f.opsFor('design_runs')
    expect(ops[0]).toEqual(['update', { base_snapshot: { pagePath: '/x', rendersSweptAt: '2026-09-25T12:02:00.000Z' } }])
    expect(ops).toContainEqual(['eq', 'status', 'cancelled'])
    expect(ops).toContainEqual(['eq', 'updated_at', 'u1'])
  })
})
