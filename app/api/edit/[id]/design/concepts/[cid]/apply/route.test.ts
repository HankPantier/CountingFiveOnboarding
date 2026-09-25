import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { asJson } from '@/lib/supabase/json-typed'
import { CID, RID, SID, makeConceptRow, makeRunRow, makeVersionRow } from '@/lib/design/__fixtures__/rows'
import { BRAND_TEXT, DESIGN_TEXT } from '@/lib/design/__fixtures__/theme-texts'
import { VALID } from '@/lib/design/__fixtures__/valid-bundle'
import { CURATED_FONTS } from '@/lib/content/type-pairing-catalog'
import { StaleShaError } from '@/lib/github/repo-files'
import { DEFAULT_CAPABILITIES } from '@/lib/design/run-types'
import { newReview, UNMEASURED_WARNING } from '@/lib/design/review'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  getConcept: vi.fn(),
  getRun: vi.fn(),
  markRunApplied: vi.fn(async (..._a: unknown[]) => {}),
  snapshot: vi.fn(),
  caps: vi.fn(),
  apply: vi.fn(),
  sync: vi.fn(async (..._a: unknown[]) => {}),
  insertVersion: vi.fn(),
}))
vi.mock('../../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/run-store', () => ({
  getConcept: (...a: unknown[]) => m.getConcept(...a),
  getRun: (...a: unknown[]) => m.getRun(...a),
  markRunApplied: (...a: unknown[]) => m.markRunApplied(...a),
}))
// The real pure themeTextsFromSnapshot runs on the mocked snapshot (PF9).
vi.mock('@/lib/design/theme-snapshot', async (orig) => ({
  ...((await orig()) as object),
  readDraftThemeSnapshot: (r: string) => m.snapshot(r),
}))
vi.mock('@/lib/design/capabilities-read', () => ({ readDesignCapabilities: (r: string) => m.caps(r) }))
vi.mock('@/lib/design/apply-bundle', () => ({ applyBundleToDraft: (a: unknown) => m.apply(a) }))
vi.mock('@/lib/design/sync-mbp-theme', () => ({ syncMbpTheme: (...a: unknown[]) => m.sync(...a) }))
vi.mock('@/lib/design/store', async (orig) => ({ ...((await orig()) as object), insertVersion: (...a: unknown[]) => m.insertVersion(...a) }))

import { VersionConflictError } from '@/lib/design/store'
import { POST } from './route'

const SHOT = { viewport: 'desktop', path: `design/${SID}/runs/${RID}/concept-0-desktop-aaaaaaaa.webp`, width: 1440, height: 900 }
const BEFORE = { shas: { 'content/brand.json': 'a'.repeat(40), 'content/design.json': 'b'.repeat(40) }, texts: { 'content/brand.json': BRAND_TEXT, 'content/design.json': DESIGN_TEXT } }
const AFTER_SHAS = {
  'content/brand.json': 'c'.repeat(40),
  'content/design.json': 'd'.repeat(40),
  'src/styles/theme.css': 'e'.repeat(40),
  'content/design-overrides.css': 'f'.repeat(40),
}
const APPLIED = {
  ok: true,
  commitSha: '1'.repeat(40),
  blobs: { 'content/brand.json': 'c'.repeat(40) },
  changedPaths: ['content/brand.json', 'src/styles/theme.css', 'content/design-overrides.css'],
  brand: { palette: VALID.palette },
  design: {},
  css: { blocks: { hero: '[data-block="hero"] h1 { letter-spacing: -0.02em; }' } },
}

const call = (body: unknown = {}, cid = CID) =>
  POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), {
    params: Promise.resolve({ id: SID, cid }),
  })

beforeEach(() => {
  vi.resetAllMocks() // drops unconsumed mockResolvedValueOnce snapshots between tests
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  m.gate.mockResolvedValue({ sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', adminEmail: 'a@x.com', adminName: 'Ada', user: { isAdmin: true } })
  m.getConcept.mockResolvedValue(makeConceptRow({ status: 'ready', screenshots: asJson([SHOT]) }))
  m.getRun.mockResolvedValue(makeRunRow({ status: 'ready' }))
  m.snapshot.mockResolvedValueOnce(BEFORE).mockResolvedValueOnce({ shas: AFTER_SHAS, texts: {} })
  m.caps.mockResolvedValue(DEFAULT_CAPABILITIES)
  m.apply.mockResolvedValue(APPLIED)
  m.insertVersion.mockResolvedValue(makeVersionRow({ id: 'ver-3', version_no: 3, source: 'concept' }))
})

describe('POST /design/concepts/[cid]/apply', () => {
  it('passes the gate response through', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await call()).status).toBe(403)
  })
  it('400s a bad concept id and a non-boolean flag', async () => {
    expect((await call({}, 'nope')).status).toBe(400)
    expect((await call({ removeLegacyOverrides: 'yes' })).status).toBe(400)
  })
  it('404s a concept from another session', async () => {
    m.getConcept.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(m.getConcept).toHaveBeenCalledWith({}, SID, CID)
  })
  it('409s a concept that is not ready', async () => {
    m.getConcept.mockResolvedValue(makeConceptRow({ status: 'refining' }))
    expect((await call()).status).toBe(409)
  })
  it('422s a font change when the template is below L2', async () => {
    const other = CURATED_FONTS.find((f) => f !== 'Public Sans' && f !== 'Fraunces') as string
    m.getConcept.mockResolvedValue(makeConceptRow({ status: 'ready', bundle: asJson({ ...VALID, typography: { ...VALID.typography, headingFont: other } }) }))
    const res = await call()
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('Fonts are locked')
    expect(m.apply).not.toHaveBeenCalled()
  })

  it('applies with legacy overrides removed by default and records a FULL-blob concept version', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, versionId: 'ver-3', versionNo: 3, commitSha: '1'.repeat(40), changedPaths: APPLIED.changedPaths, warnings: [UNMEASURED_WARNING] })

    const applyArgs = m.apply.mock.calls[0][0] as { githubRepo: string; removeLegacy: boolean; bundle: { name: string }; author: { name: string; email: string } }
    expect(applyArgs).toMatchObject({ githubRepo: 'o/r', removeLegacy: true, author: { name: 'Ada', email: 'a@x.com' } })
    expect(applyArgs.bundle.name).toBe('Harbor Ledger')

    expect(m.sync).toHaveBeenCalledWith({}, { sessionId: SID, jobId: 'job-1', brand: APPLIED.brand, design: undefined })

    const version = m.insertVersion.mock.calls[0][1] as Record<string, unknown>
    expect(version).toMatchObject({
      sessionId: SID,
      source: 'concept',
      appliedCommitSha: '1'.repeat(40),
      appliedBlobs: AFTER_SHAS,
      conceptId: CID,
      createdBy: 'admin-1',
      screenshots: [SHOT],
    })
    expect((version.bundle as { css: unknown }).css).toEqual(APPLIED.css)
    expect(m.markRunApplied).toHaveBeenCalledWith({}, RID)
  })

  it('409s a draft without brand.json / design.json before touching the repo', async () => {
    m.snapshot.mockReset().mockResolvedValue({ shas: {}, texts: {} })
    const res = await call()
    expect(res.status).toBe(409)
    expect(m.apply).not.toHaveBeenCalled()
  })

  it('keeps legacy overrides when asked', async () => {
    await call({ removeLegacyOverrides: false })
    expect((m.apply.mock.calls[0][0] as { removeLegacy: boolean }).removeLegacy).toBe(false)
  })

  it('prefers the written blobs over a stale post-apply snapshot', async () => {
    const stale = { ...AFTER_SHAS, 'content/brand.json': 'a'.repeat(40) } // pre-commit tip for the changed file
    m.snapshot.mockReset().mockResolvedValueOnce(BEFORE).mockResolvedValueOnce({ shas: stale, texts: {} })
    await call()
    expect((m.insertVersion.mock.calls[0][1] as { appliedBlobs: unknown }).appliedBlobs).toEqual({
      'content/brand.json': 'c'.repeat(40),
      'content/design.json': 'd'.repeat(40),
      'src/styles/theme.css': 'e'.repeat(40),
      'content/design-overrides.css': 'f'.repeat(40),
    })
  })

  it('falls back to before-shas + written blobs when the post-apply snapshot fails', async () => {
    m.snapshot.mockReset().mockResolvedValueOnce(BEFORE).mockRejectedValueOnce(new Error('github down'))
    await call()
    expect((m.insertVersion.mock.calls[0][1] as { appliedBlobs: unknown }).appliedBlobs).toEqual({
      'content/brand.json': 'c'.repeat(40),
      'content/design.json': 'b'.repeat(40),
    })
  })

  it('passes a contrast (or other) apply refusal through with its status', async () => {
    m.apply.mockResolvedValue({ ok: false, status: 422, error: 'The palette fails contrast checks — x.' })
    const res = await call()
    expect(res.status).toBe(422)
    expect(m.insertVersion).not.toHaveBeenCalled()
  })

  it('maps a concurrent edit (StaleShaError) to 409', async () => {
    m.apply.mockRejectedValue(new StaleShaError('content/brand.json', 'x', 'y'))
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).stale).toBe(true)
  })

  it('says the concept WAS applied when recording the version conflicts', async () => {
    m.insertVersion.mockRejectedValue(new VersionConflictError(SID))
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('The design was applied to the draft, but its version number could not be recorded — refresh the Studio.')
  })

  it('says the concept WAS applied when recording the version fails, without leaking DB text', async () => {
    m.insertVersion.mockRejectedValue(new Error('insert design_versions: permission denied for table design_versions'))
    const res = await call()
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toEqual({ error: 'The design was applied to the draft, but its version could not be recorded — refresh the Studio.' })
    expect(JSON.stringify(body)).not.toContain('design_versions')
    expect(console.error).toHaveBeenCalled()
    expect(m.apply).toHaveBeenCalledTimes(1)
  })

  it('hides raw errors behind a generic 500', async () => {
    m.apply.mockRejectedValue(new Error('octokit secret detail'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to apply the concept' })
  })
})

describe('render hard gates (P4)', () => {
  const OVERFLOW = { v: 1, viewports: [{ viewport: 'mobile', textChecked: 1, textUnverified: 0, contrast: [], overflow: { scrollWidth: 430, viewportWidth: 390, offenders: [] }, hidden: [] }] }
  const CLEAN = { v: 1, viewports: [{ viewport: 'mobile', textChecked: 1, textUnverified: 0, contrast: [], overflow: null, hidden: [] }] }
  const withMetrics = (metrics: unknown) => makeConceptRow({ status: 'ready', critique: asJson({ ...newReview(), next: 'done', outcome: 'max_revisions', metrics }) })

  it('422s a concept whose latest render fails a gate, listing the failures, and never touches the draft', async () => {
    m.getConcept.mockResolvedValue(withMetrics(OVERFLOW))
    const res = await call()
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string; failures: string[] }
    expect(body.error).toMatch(/^This concept fails the render checks, so it can’t be applied: /)
    expect(body.failures[0]).toContain('wider than the screen')
    expect(m.apply).not.toHaveBeenCalled()
  })
  it('lets a failure the current site already has through (baseline diff)', async () => {
    m.getConcept.mockResolvedValue(withMetrics(OVERFLOW))
    m.getRun.mockResolvedValue(makeRunRow({ status: 'ready', base_snapshot: asJson({ pagePath: '/', themeShas: {}, screenshots: [], notes: [], metrics: OVERFLOW }) }))
    const res = await call()
    expect(res.status).toBe(200)
    expect(((await res.json()) as { warnings: string[] }).warnings).toEqual([])
  })
  it('applies a clean concept with no warnings', async () => {
    m.getConcept.mockResolvedValue(withMetrics(CLEAN))
    const res = await call()
    expect(res.status).toBe(200)
    expect(((await res.json()) as { warnings: string[] }).warnings).toEqual([])
  })
  it('applies an unmeasured concept (renderer unavailable / pre-P4) with a warning', async () => {
    m.getConcept.mockResolvedValue(makeConceptRow({ status: 'ready', critique: null }))
    const res = await call()
    expect(res.status).toBe(200)
    expect(((await res.json()) as { warnings: string[] }).warnings[0]).toMatch(/not checked for contrast/)
  })
})
