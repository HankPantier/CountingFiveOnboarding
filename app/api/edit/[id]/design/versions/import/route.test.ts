import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { asJson } from '@/lib/supabase/json-typed'
import { SID, makeVersionRow } from '@/lib/design/__fixtures__/rows'
import { BRAND_TEXT, DESIGN_TEXT } from '@/lib/design/__fixtures__/theme-texts'
import { DEFAULT_CAPABILITIES } from '@/lib/design/run-types'

const m = vi.hoisted(() => ({ gate: vi.fn(), snapshot: vi.fn(), latest: vi.fn(), insert: vi.fn(), caps: vi.fn() }))
vi.mock('@/lib/design/capabilities-read', () => ({ readDesignCapabilities: (r: string) => m.caps(r) }))
vi.mock('../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/theme-snapshot', async (orig) => ({ ...((await orig()) as object), readDraftThemeSnapshot: (r: string) => m.snapshot(r) }))
vi.mock('@/lib/design/store', async (orig) => ({
  ...((await orig()) as object),
  latestVersion: (...a: unknown[]) => m.latest(...a),
  insertVersion: (...a: unknown[]) => m.insert(...a),
}))

import { VersionConflictError } from '@/lib/design/store'
import { CAPTURED_NAME } from '@/lib/design/store'
import { POST } from './route'

const call = () => POST(new Request('http://x/api', { method: 'POST' }), { params: Promise.resolve({ id: SID }) })
const V3 = { 'content/brand.json': 'a'.repeat(40), 'content/design.json': 'b'.repeat(40) }
const DRIFTED = { ...V3, 'content/brand.json': 'c'.repeat(40) }
const snap = (shas: Record<string, string>, overridesCss = '') => ({
  shas,
  texts: { 'content/brand.json': BRAND_TEXT, 'content/design.json': DESIGN_TEXT, 'content/design-overrides.css': overridesCss },
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.gate.mockResolvedValue({ sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.snapshot.mockResolvedValue(snap(DRIFTED))
  m.latest.mockResolvedValue(makeVersionRow({ version_no: 3, applied_blobs: asJson(V3) }))
  m.insert.mockResolvedValue(makeVersionRow({ id: 'ver-4', version_no: 4, source: 'import' }))
  m.caps.mockResolvedValue(DEFAULT_CAPABILITIES)
})

describe('POST /design/versions/import', () => {
  it('passes the gate response through', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await call()).status).toBe(403)
  })
  it('409s when the draft already matches the latest version', async () => {
    m.snapshot.mockResolvedValue(snap(V3))
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Nothing to capture — the draft already matches v3.')
    expect(m.insert).not.toHaveBeenCalled()
  })
  it('captures a drifted draft as an import version with the FULL current blob map', async () => {
    const res = await call()
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true, versionId: 'ver-4', versionNo: 4 })
    const v = m.insert.mock.calls[0][1] as { source: string; appliedBlobs: unknown; appliedCommitSha: unknown; summary: string; bundle: { name: string; meta: { source: string } } }
    expect(v).toMatchObject({ source: 'import', appliedBlobs: DRIFTED, appliedCommitSha: null })
    expect(v.bundle.name).toBe(CAPTURED_NAME)
    expect(v.bundle.meta.source).toBe('import')
    expect(v.summary).toContain('brand.json')
  })
  it('409s malformed override markers and missing theme files', async () => {
    m.snapshot.mockResolvedValue(snap(DRIFTED, '/* design-studio:begin */\n/* design-studio:begin */'))
    expect((await call()).status).toBe(409)
    m.snapshot.mockResolvedValue({ shas: {}, texts: {} })
    expect((await call()).status).toBe(409)
    expect(m.insert).not.toHaveBeenCalled()
  })
  it('maps a version-number conflict to 409 and hides other errors behind a 500', async () => {
    m.insert.mockRejectedValueOnce(new VersionConflictError(SID))
    expect((await call()).status).toBe(409)
    m.insert.mockRejectedValueOnce(new Error('permission denied for table design_versions'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('design_versions')
  })

  describe('fonts module (L2+ drafts)', () => {
    const L2 = { level: 2, source: 'marker', templateVersion: '2026.09.1', capabilities: ['fonts'] }
    const FONTS = 'src/app/fonts.generated.ts'

    it('L2 draft: captures the module in applied_blobs', async () => {
      m.caps.mockResolvedValue(L2)
      m.snapshot.mockResolvedValue(snap({ ...DRIFTED, [FONTS]: 'f'.repeat(40) }))
      expect((await call()).status).toBe(201)
      expect(m.caps).toHaveBeenCalledWith('o/r')
      const v = m.insert.mock.calls[0][1] as { appliedBlobs: unknown }
      expect(v.appliedBlobs).toEqual({ ...DRIFTED, [FONTS]: 'f'.repeat(40) })
    })

    it('L1 draft: the module never enters applied_blobs', async () => {
      m.snapshot.mockResolvedValue(snap({ ...DRIFTED, [FONTS]: 'f'.repeat(40) }))
      expect((await call()).status).toBe(201)
      const v = m.insert.mock.calls[0][1] as { appliedBlobs: unknown }
      expect(v.appliedBlobs).toEqual(DRIFTED)
    })

    it('L2 draft: a changed module alone is drift worth capturing', async () => {
      m.caps.mockResolvedValue(L2)
      m.latest.mockResolvedValue(makeVersionRow({ version_no: 3, applied_blobs: asJson({ ...V3, [FONTS]: '1'.repeat(40) }) }))
      m.snapshot.mockResolvedValue(snap({ ...V3, [FONTS]: 'f'.repeat(40) }))
      const res = await call()
      expect(res.status).toBe(201)
      expect((m.insert.mock.calls[0][1] as { summary: string }).summary).toContain('fonts.generated.ts')
    })
  })
})
