import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SID } from './__fixtures__/rows'
import { DRAFT_FILES } from './__fixtures__/theme-texts'
import { bundleFromRepoFiles } from './bundle-files'

type Row = { kind: string; key: string; label: string; snapshot: unknown; created_by: string | null; created_at: string; id: string; session_id: string }
const m = vi.hoisted(() => ({ rows: [] as Row[] }))
vi.mock('./lock-store', async (orig) => {
  const real = (await orig()) as typeof import('./lock-store')
  return {
    ...real,
    listLockRows: async () => [...m.rows],
    insertLocks: async (_db: unknown, _sid: string, locks: { kind: string; key: string; label: string; snapshot: unknown }[], createdBy: string | null) => {
      const fresh = locks.filter((l) => !m.rows.some((r) => r.kind === l.kind && r.key === l.key))
      m.rows.push(...fresh.map((l, i) => ({ ...l, created_by: createdBy, created_at: `t${i}`, id: `id-${l.key}`, session_id: SID })))
      return fresh
    },
    deleteLocks: async (_db: unknown, _sid: string, keys: { kind: string; key: string }[]) => {
      const before = m.rows.length
      m.rows = m.rows.filter((r) => !keys.some((k) => k.kind === r.kind && k.key === r.key))
      return before - m.rows.length
    },
  }
})

import { changeLocks, NOTHING_TO_CHANGE_ERROR } from './lock-ops'
import type { CommitVersionResult } from './commit-version'

const DB = {} as never
const TARGET = { sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', adminEmail: 'a@x.com' }
const BASE = (() => {
  const r = bundleFromRepoFiles(DRAFT_FILES, { name: 'Current', source: 'chat' })
  if (!r.ok) throw new Error('fixture')
  return { bundle: r.bundle, files: DRAFT_FILES, shas: { 'content/brand.json': 'a'.repeat(40) } }
})()
const committed: CommitVersionResult = {
  ok: true,
  version: { id: 'ver-7', version_no: 7 } as never,
  commitSha: 'c',
  changedPaths: ['content/design-overrides.css'],
  appliedBlobs: { 'content/brand.json': 'b'.repeat(40) },
  css: { blocks: {} },
}

beforeEach(() => {
  m.rows = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('changeLocks', () => {
  it('locks an area with a snapshot of the draft, then commits the pins on the caller’s base shas', async () => {
    const commitVersion = vi.fn(async () => committed)
    const r = await changeLocks(DB, { target: TARGET, base: BASE, change: { op: 'lock', areas: ['service-cards'], levers: [], label: 'Service cards (What we do)' }, commitVersion })
    expect(r).toMatchObject({ ok: true, changed: ['Service cards (What we do)'], versionNo: 7, appliedBlobs: committed.ok ? committed.appliedBlobs : {} })
    expect(m.rows[0]).toMatchObject({ kind: 'area', key: 'service-cards', label: 'Service cards (What we do)' })
    expect((m.rows[0].snapshot as { vars: Record<string, string> }).vars['--color-primary']).toMatch(/^hsl\(/)
    const call = commitVersion.mock.calls[0] as unknown as [{ source: string; syncMbp: boolean; expectedShas: unknown; summary: string; skipIfUnchanged: boolean }]
    expect(call[0]).toMatchObject({ source: 'chat', syncMbp: false, expectedShas: BASE.shas, summary: 'Locked Service cards (What we do)', skipIfUnchanged: true })
    expect(r.ok && r.bundle.css.locks).toContain('service-cards')
  })

  it('re-locking something already locked changes nothing and commits nothing', async () => {
    const commitVersion = vi.fn(async () => committed)
    await changeLocks(DB, { target: TARGET, base: BASE, change: { op: 'lock', areas: [], levers: ['palette'] }, commitVersion })
    const again = await changeLocks(DB, { target: TARGET, base: BASE, change: { op: 'lock', areas: [], levers: ['palette'] }, commitVersion })
    expect(again).toMatchObject({ ok: true, changed: [], versionNo: null })
    expect(commitVersion).toHaveBeenCalledTimes(1)
  })

  it('a refused commit undoes the new rows, and a refused unlock restores the removed ones', async () => {
    const refused = vi.fn(async (): Promise<CommitVersionResult> => ({ ok: false, status: 409, error: 'stale' }))
    expect(await changeLocks(DB, { target: TARGET, base: BASE, change: { op: 'lock', areas: ['navbar'], levers: [], label: 'Nav' }, commitVersion: refused })).toEqual({ ok: false, status: 409, error: 'stale' })
    expect(m.rows).toEqual([])

    await changeLocks(DB, { target: TARGET, base: BASE, change: { op: 'lock', areas: ['navbar'], levers: [] }, commitVersion: vi.fn(async () => committed) })
    const snapshot = m.rows[0].snapshot
    await changeLocks(DB, { target: TARGET, base: BASE, change: { op: 'unlock', keys: [{ kind: 'area', key: 'navbar' }] }, commitVersion: refused })
    expect(m.rows).toHaveLength(1)
    expect(m.rows[0].snapshot).toEqual(snapshot)
  })

  it('unlocks and commits the pins away', async () => {
    await changeLocks(DB, { target: TARGET, base: BASE, change: { op: 'lock', areas: ['navbar'], levers: [] }, commitVersion: vi.fn(async () => committed) })
    const commitVersion = vi.fn(async () => committed)
    const r = await changeLocks(DB, { target: TARGET, base: BASE, change: { op: 'unlock', keys: [{ kind: 'area', key: 'navbar' }] }, commitVersion })
    expect(r).toMatchObject({ ok: true, changed: ['Navbar'], locks: [] })
    expect(r.ok && r.bundle.css.locks).toBeFalsy()
  })

  it('refuses an empty request', async () => {
    const r = await changeLocks(DB, { target: TARGET, base: BASE, change: { op: 'lock', areas: [], levers: [] }, commitVersion: vi.fn() })
    expect(r).toEqual({ ok: false, status: 400, error: NOTHING_TO_CHANGE_ERROR })
  })
})
