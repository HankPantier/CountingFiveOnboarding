import { describe, it, expect, vi } from 'vitest'
import { DESIGN_ORPHAN_MIN_AGE_MS, isStorageSweepSlot, sweepDesignStorageOrphans, type OrphanSweepDeps, type StorageEntry } from './storage-sweep'

const NOW = Date.parse('2026-09-25T12:02:00.000Z')
const OLD = new Date(NOW - DESIGN_ORPHAN_MIN_AGE_MS - 1000).toISOString()
const NEW = new Date(NOW - 60_000).toISOString()
const SID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const A_SENT = '11111111-1111-4111-8111-111111111111'
const A_UNSENT = '22222222-2222-4222-8222-222222222222'
const A_FRESH = '33333333-3333-4333-8333-333333333333'

function deps(tree: Record<string, StorageEntry[]>, referenced: string[]) {
  const removed: string[][] = []
  const d: OrphanSweepDeps = {
    list: async (prefix, offset) => (offset === 0 ? (tree[prefix] ?? []) : []),
    remove: async (paths) => {
      removed.push(paths)
    },
    isAttachmentReferenced: async (_sid, id) => referenced.includes(id),
  }
  return { d, removed }
}

describe('sweepDesignStorageOrphans', () => {
  it('drops old /design/render outputs and unsent attachments, never chat previews or referenced/fresh files', async () => {
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
      [A_SENT]
    )
    expect(await sweepDesignStorageOrphans(d, NOW)).toEqual({ renders: 1, attachments: 1 })
    expect(removed.flat()).toEqual([`design/${SID}/renders/aaaa-desktop-0.webp`, `design/${SID}/attachments/${A_UNSENT}.webp`])
  })

  it('never throws: a listing failure logs and returns zero', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d: OrphanSweepDeps = {
      list: async () => {
        throw new Error('storage down')
      },
      remove: async () => {},
      isAttachmentReferenced: async () => false,
    }
    expect(await sweepDesignStorageOrphans(d, NOW)).toEqual({ renders: 0, attachments: 0 })
    err.mockRestore()
  })

  it('runs in one 5-minute slot per hour', () => {
    expect(isStorageSweepSlot(Date.parse('2026-09-25T12:03:00Z'))).toBe(true)
    expect(isStorageSweepSlot(Date.parse('2026-09-25T12:07:00Z'))).toBe(false)
  })
})
