import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { asJson } from '@/lib/supabase/json-typed'
import { SID, makeVersionRow } from '@/lib/design/__fixtures__/rows'
import { VALID } from '@/lib/design/__fixtures__/valid-bundle'

const VID = '5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e'
const m = vi.hoisted(() => ({ gate: vi.fn(), getVersion: vi.fn(), commit: vi.fn(), snapshotAt: vi.fn() }))
vi.mock('@/lib/design/theme-snapshot', () => ({ readThemeSnapshotAt: (...a: unknown[]) => m.snapshotAt(...a) }))
vi.mock('../../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/store', async (orig) => ({ ...((await orig()) as object), getVersion: (...a: unknown[]) => m.getVersion(...a) }))
vi.mock('@/lib/design/commit-version', () => ({ commitDesignVersion: (...a: unknown[]) => m.commit(...a) }))

import { POST } from './route'

const call = (vid = VID) => POST(new Request('http://x/api', { method: 'POST' }), { params: Promise.resolve({ id: SID, vid }) })
const SHOT = { viewport: 'desktop', path: `design/${SID}/runs/r/concept-0-r0-desktop.webp`, width: 1440, height: 900 }

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.gate.mockResolvedValue({ sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', adminEmail: 'a@x.com', adminName: 'Ada', user: { isAdmin: true } })
  m.getVersion.mockResolvedValue(makeVersionRow({ id: VID, version_no: 2, source: 'concept', bundle: asJson(VALID), screenshots: asJson([SHOT]) }))
  m.commit.mockResolvedValue({ ok: true, version: makeVersionRow({ id: 'ver-7', version_no: 7, source: 'revert' }), commitSha: '1'.repeat(40), changedPaths: ['content/brand.json'], appliedBlobs: {}, css: { blocks: {} } })
})

describe('POST /design/versions/[vid]/restore', () => {
  it('passes the gate response through', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await call()).status).toBe(403)
  })
  it('400s a bad id and 404s a version from another session', async () => {
    expect((await call('nope')).status).toBe(400)
    m.getVersion.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(m.getVersion).toHaveBeenCalledWith({}, SID, VID)
  })
  it('422s a version whose stored bundle no longer parses', async () => {
    m.getVersion.mockResolvedValue(makeVersionRow({ id: VID, version_no: 2, bundle: asJson({ name: 'x' }) }))
    expect((await call()).status).toBe(422)
    expect(m.commit).not.toHaveBeenCalled()
  })
  it('re-applies version k as a NEW forward revert version, keeping hand-written CSS', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, versionId: 'ver-7', versionNo: 7, restoredFrom: 2, commitSha: '1'.repeat(40), changedPaths: ['content/brand.json'], warnings: [] })
    const a = m.commit.mock.calls[0][1] as { source: string; removeLegacy: boolean; summary: string; bundle: { meta: { source: string }; name: string }; screenshots: unknown[] }
    expect(a).toMatchObject({ source: 'revert', removeLegacy: false, summary: 'Restored v2 “Harbor Ledger”' })
    expect(a.bundle.meta.source).toBe('revert')
    // The version's own name is "Restored v{k} — {original name}" (fits the
    // cap here), NOT the original bundle's name carried over verbatim.
    expect(a.bundle.name).toBe('Restored v2 — Harbor Ledger')
    expect(a.screenshots).toEqual([SHOT])
  })
  it('names a restored version "Restored v{k}" alone when the original name would blow the cap', async () => {
    const longName = 'B'.repeat(50) // fits the bundle's own 60-char cap, but not alongside "Restored v2 — "
    m.getVersion.mockResolvedValue(makeVersionRow({ id: VID, version_no: 2, source: 'concept', bundle: asJson({ ...VALID, name: longName }), screenshots: asJson([SHOT]) }))
    const res = await call()
    expect(res.status).toBe(200)
    const a = m.commit.mock.calls[0][1] as { bundle: { name: string } }
    expect(a.bundle.name).toBe('Restored v2')
  })
  it('passes a commit refusal through (stale → stale: true)', async () => {
    m.commit.mockResolvedValue({ ok: false, status: 409, error: 'The theme changed while applying — refresh the Studio and try again.', stale: true })
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'The theme changed while applying — refresh the Studio and try again.', stale: true })
  })
  it('hides raw errors behind a 500', async () => {
    m.commit.mockRejectedValue(new Error('octokit secret'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to restore the version' })
  })
})

describe('restoring a baseline / captured version (hand CSS outside the region)', () => {
  const OVR = 'content/design-overrides.css'
  const ORIGINAL_SHA = 'a'.repeat(40)
  const ORIGINAL = '/* hand polish */\n[data-block="hero"] h1 { letter-spacing: -0.01em; }\n'
  const baselineRow = (blobs: Record<string, string>) =>
    makeVersionRow({ id: VID, version_no: 0, source: 'baseline', bundle: asJson({ ...VALID, name: 'Baseline' }), applied_blobs: asJson(blobs) })

  it('writes the recorded design-overrides.css back verbatim', async () => {
    m.getVersion.mockResolvedValue(baselineRow({ [OVR]: ORIGINAL_SHA }))
    m.snapshotAt.mockResolvedValue({ shas: { [OVR]: ORIGINAL_SHA }, texts: { [OVR]: ORIGINAL } })
    const res = await call()
    expect(res.status).toBe(200)
    expect(m.snapshotAt).toHaveBeenCalledWith('o/r', { [OVR]: ORIGINAL_SHA })
    expect((m.commit.mock.calls[0][1] as { overridesVerbatim?: string }).overridesVerbatim).toBe(ORIGINAL)
    expect((await res.json()).warnings).toEqual([])
  })

  it('warns clearly when the recorded overrides blob cannot be read back', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    m.getVersion.mockResolvedValue(baselineRow({ [OVR]: ORIGINAL_SHA }))
    m.snapshotAt.mockRejectedValue(new Error('404'))
    const res = await call()
    expect(res.status).toBe(200)
    expect((m.commit.mock.calls[0][1] as { overridesVerbatim?: string }).overridesVerbatim).toBeUndefined()
    expect((await res.json()).warnings[0]).toMatch(/couldn’t be read back/)
  })

  it('a baseline recorded with no overrides file restores an empty one', async () => {
    m.getVersion.mockResolvedValue(baselineRow({}))
    await call()
    expect((m.commit.mock.calls[0][1] as { overridesVerbatim?: string }).overridesVerbatim).toBe('')
    expect(m.snapshotAt).not.toHaveBeenCalled()
  })

  it('a concept/chat restore whose overrides end up different from the version’s warns', async () => {
    m.getVersion.mockResolvedValue(makeVersionRow({ id: VID, version_no: 2, source: 'chat', bundle: asJson(VALID), applied_blobs: asJson({ [OVR]: ORIGINAL_SHA }) }))
    m.commit.mockResolvedValue({ ok: true, version: makeVersionRow({ id: 'ver-7', version_no: 7, source: 'revert' }), commitSha: null, changedPaths: [], appliedBlobs: { [OVR]: 'b'.repeat(40) }, css: { blocks: {} } })
    const res = await call()
    expect((await res.json()).warnings[0]).toMatch(/differs from v2/)
    expect((m.commit.mock.calls[0][1] as { overridesVerbatim?: string }).overridesVerbatim).toBeUndefined()
  })
})
