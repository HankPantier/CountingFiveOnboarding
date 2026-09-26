import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SID, makeVersionRow } from './__fixtures__/rows'
import { BRAND_TEXT, DESIGN_TEXT } from './__fixtures__/theme-texts'
import { VALID } from './__fixtures__/valid-bundle'
import { CURATED_FONTS } from '@/lib/content/type-pairing-catalog'
import { StaleShaError } from '@/lib/github/repo-files'
import { DEFAULT_CAPABILITIES } from './run-types'

const m = vi.hoisted(() => ({
  snapshot: vi.fn(),
  snapshotAt: vi.fn(),
  caps: vi.fn(),
  apply: vi.fn(),
  sync: vi.fn(async (..._a: unknown[]) => {}),
  insertVersion: vi.fn(),
}))
vi.mock('./theme-snapshot', async (orig) => ({ ...((await orig()) as object), readDraftThemeSnapshot: (r: string) => m.snapshot(r), readThemeSnapshotAt: (r: string, s: unknown) => m.snapshotAt(r, s) }))
vi.mock('./capabilities-read', () => ({ readDesignCapabilities: (r: string) => m.caps(r) }))
vi.mock('./apply-bundle', () => ({ applyBundleToDraft: (a: unknown) => m.apply(a) }))
vi.mock('./sync-mbp-theme', () => ({ syncMbpTheme: (...a: unknown[]) => m.sync(...a) }))
vi.mock('./store', async (orig) => ({ ...((await orig()) as object), insertVersion: (...a: unknown[]) => m.insertVersion(...a) }))

import { VersionConflictError } from './store'
import {
  APPLIED_VERSION_NUMBER_UNRECORDED,
  APPLIED_VERSION_UNRECORDED,
  LEGACY_KEEP_UNCHECKED_ERROR,
  STALE_THEME_ERROR,
  commitDesignVersion,
  type CommitVersionArgs,
} from './commit-version'

const DB = {} as never
const BEFORE_SHAS = { 'content/brand.json': 'a'.repeat(40), 'content/design.json': 'b'.repeat(40) }
const BEFORE = { shas: BEFORE_SHAS, texts: { 'content/brand.json': BRAND_TEXT, 'content/design.json': DESIGN_TEXT } }
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
  changedPaths: ['content/brand.json', 'src/styles/theme.css'],
  brand: { palette: VALID.palette },
  design: {},
  css: { blocks: { hero: '[data-block="hero"] h1 {\n  letter-spacing: -0.02em;\n}' } },
}
const TARGET = { sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', adminEmail: 'a@x.com', adminName: 'Ada' }
const args = (over: Partial<CommitVersionArgs> = {}): CommitVersionArgs => ({
  target: TARGET,
  bundle: { ...VALID, meta: { source: 'chat' } },
  source: 'chat',
  removeLegacy: false,
  syncMbp: true,
  summary: 'Chat: calmer cards',
  commitMessage: 'Design Studio chat: calmer cards (a@x.com)',
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  m.snapshot.mockResolvedValueOnce(BEFORE).mockResolvedValueOnce({ shas: AFTER_SHAS, texts: {} })
  m.snapshotAt.mockImplementation(async (_r: string, shas: Record<string, string>) => ({ shas, texts: BEFORE.texts }))
  m.caps.mockResolvedValue(DEFAULT_CAPABILITIES)
  m.apply.mockResolvedValue(APPLIED)
  m.insertVersion.mockResolvedValue(makeVersionRow({ id: 'ver-5', version_no: 5, source: 'chat' }))
})

describe('commitDesignVersion', () => {
  it('applies, mirrors only what changed to the MBP, and records a FULL-blob version', async () => {
    const r = await commitDesignVersion(DB, args({ screenshots: [{ viewport: 'desktop', path: `design/${SID}/renders/chat/x-p1-desktop.webp`, width: 1440, height: 900 }] }))
    expect(r).toMatchObject({ ok: true, commitSha: '1'.repeat(40), changedPaths: APPLIED.changedPaths, appliedBlobs: AFTER_SHAS })
    expect(m.apply.mock.calls[0][0]).toMatchObject({ githubRepo: 'o/r', removeLegacy: false, message: 'Design Studio chat: calmer cards (a@x.com)', author: { name: 'Ada', email: 'a@x.com' } })
    expect(m.sync).toHaveBeenCalledWith(DB, { sessionId: SID, jobId: 'job-1', brand: APPLIED.brand, design: undefined })
    const v = m.insertVersion.mock.calls[0][1] as Record<string, unknown>
    expect(v).toMatchObject({ sessionId: SID, source: 'chat', summary: 'Chat: calmer cards', appliedBlobs: AFTER_SHAS, conceptId: null, createdBy: 'admin-1' })
    expect((v.bundle as { css: unknown }).css).toEqual(APPLIED.css)
    expect((v.screenshots as unknown[]).length).toBe(1)
  })

  // PF2: expectedShas is the base the caller built on. It is handed straight to
  // applyBundleToDraft (whose writeFiles sha guard is the ONLY staleness
  // check) — no snapshot-vs-expected pre-comparison that a lagging read could
  // false-409.
  it('refuses to keep legacy hand CSS the caller’s render gate never measured (concept apply)', async () => {
    m.snapshot.mockReset().mockResolvedValue({
      shas: BEFORE_SHAS,
      texts: { ...BEFORE.texts, 'content/design-overrides.css': '[data-block="hero"] h1 { color: #fff; }\n' },
    })
    const r = await commitDesignVersion(DB, args({ source: 'concept', removeLegacy: false, gateRenderedWithoutLegacy: true }))
    expect(r).toEqual({ ok: false, status: 422, error: LEGACY_KEEP_UNCHECKED_ERROR })
    expect(m.apply).not.toHaveBeenCalled()
    // Removing it (what the gate measured) is fine, and so is keeping when there is none.
    expect((await commitDesignVersion(DB, args({ source: 'concept', removeLegacy: true, gateRenderedWithoutLegacy: true }))).ok).toBe(true)
  })

  it('keep-legacy with no legacy CSS on the draft applies normally', async () => {
    const r = await commitDesignVersion(DB, args({ source: 'concept', removeLegacy: false, gateRenderedWithoutLegacy: true }))
    expect(r.ok).toBe(true)
  })

  it('expectedShas: reads the base by blob sha (no branch snapshot) and hands it to apply', async () => {
    const r = await commitDesignVersion(DB, args({ expectedShas: BEFORE_SHAS }))
    expect(r.ok).toBe(true)
    expect(m.snapshotAt).toHaveBeenCalledWith('o/r', BEFORE_SHAS)
    expect(m.snapshot).not.toHaveBeenCalled()
    expect(m.apply.mock.calls[0][0]).toMatchObject({ base: { shas: BEFORE_SHAS, texts: BEFORE.texts } })
    // The commit was guarded against the base, so the base + written blobs ARE the applied map.
    expect(r).toMatchObject({ appliedBlobs: { ...BEFORE_SHAS, 'content/brand.json': 'c'.repeat(40) } })
  })

  it('expectedShas: a moved draft surfaces as apply’s StaleShaError → 409 stale', async () => {
    m.apply.mockRejectedValueOnce(new StaleShaError('content/brand.json', 'x', 'y'))
    const r = await commitDesignVersion(DB, args({ expectedShas: { ...BEFORE_SHAS, 'content/brand.json': '9'.repeat(40) } }))
    expect(r).toEqual({ ok: false, status: 409, error: STALE_THEME_ERROR, stale: true })
    expect(m.insertVersion).not.toHaveBeenCalled()
  })

  it('two sequential commits: the second, based on the first’s written blobs, succeeds even while a snapshot still shows the old tip', async () => {
    m.snapshot.mockReset().mockResolvedValue(BEFORE) // the branch read lags: always the pre-commit tip
    const first = await commitDesignVersion(DB, args())
    if (!first.ok) throw new Error('first commit failed')
    const SECOND = { ...APPLIED, commitSha: '2'.repeat(40), blobs: { 'content/design.json': '7'.repeat(40) }, changedPaths: ['content/design.json'] }
    m.apply.mockResolvedValueOnce(SECOND)
    const second = await commitDesignVersion(DB, args({ expectedShas: first.appliedBlobs }))
    expect(second).toMatchObject({ ok: true, commitSha: '2'.repeat(40) })
    expect(m.apply.mock.calls[1][0]).toMatchObject({ base: { shas: first.appliedBlobs } })
    // Not the lagging snapshot's old brand sha: the first commit's written blob.
    expect(second.ok && second.appliedBlobs).toEqual({ ...first.appliedBlobs, 'content/design.json': '7'.repeat(40) })
    expect(m.snapshot).toHaveBeenCalledTimes(2) // first commit only (before + after)
  })

  it('without expectedShas, apply gets no base (today’s behaviour)', async () => {
    await commitDesignVersion(DB, args())
    expect(m.apply.mock.calls[0][0]).not.toHaveProperty('base')
  })

  it('409s a draft without brand.json / design.json', async () => {
    m.snapshot.mockReset().mockResolvedValue({ shas: {}, texts: {} })
    const r = await commitDesignVersion(DB, args())
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(m.apply).not.toHaveBeenCalled()
  })

  it('422s a font change below L2', async () => {
    const other = CURATED_FONTS.find((f) => f !== 'Public Sans' && f !== 'Fraunces') as string
    const r = await commitDesignVersion(DB, args({ bundle: { ...VALID, typography: { ...VALID.typography, headingFont: other } } }))
    expect(r).toMatchObject({ ok: false, status: 422 })
    expect(m.apply).not.toHaveBeenCalled()
  })

  it('passes an apply refusal (contrast) through with its status', async () => {
    m.apply.mockResolvedValue({ ok: false, status: 422, error: 'The palette fails contrast checks — x.' })
    expect(await commitDesignVersion(DB, args())).toEqual({ ok: false, status: 422, error: 'The palette fails contrast checks — x.' })
    expect(m.insertVersion).not.toHaveBeenCalled()
  })

  it('maps StaleShaError to 409 stale and rethrows anything else', async () => {
    m.apply.mockRejectedValueOnce(new StaleShaError('content/brand.json', 'x', 'y'))
    expect(await commitDesignVersion(DB, args())).toEqual({ ok: false, status: 409, error: STALE_THEME_ERROR, stale: true })
    m.snapshot.mockReset().mockResolvedValue(BEFORE)
    m.apply.mockRejectedValueOnce(new Error('octokit detail'))
    await expect(commitDesignVersion(DB, args())).rejects.toThrow('octokit detail')
  })

  it('skipIfUnchanged: no commit → no MBP sync, no version, the before map as appliedBlobs', async () => {
    m.apply.mockResolvedValue({ ...APPLIED, commitSha: null, blobs: {}, changedPaths: [] })
    const r = await commitDesignVersion(DB, args({ skipIfUnchanged: true }))
    expect(r).toMatchObject({ ok: true, version: null, commitSha: null, changedPaths: [], appliedBlobs: BEFORE_SHAS })
    expect(m.sync).not.toHaveBeenCalled()
    expect(m.insertVersion).not.toHaveBeenCalled()
  })

  it('says the design WAS applied when the version cannot be recorded', async () => {
    m.insertVersion.mockRejectedValueOnce(new VersionConflictError(SID))
    expect(await commitDesignVersion(DB, args())).toEqual({ ok: false, status: 409, error: APPLIED_VERSION_NUMBER_UNRECORDED })
    m.snapshot.mockReset().mockResolvedValue(BEFORE)
    m.insertVersion.mockRejectedValueOnce(new Error('permission denied for table design_versions'))
    expect(await commitDesignVersion(DB, args())).toEqual({ ok: false, status: 409, error: APPLIED_VERSION_UNRECORDED })
    expect(console.error).toHaveBeenCalled()
  })

  // PF3: chat commits must not write schema_data (CLAUDE.md: interactive AI
  // sessions never silently mutate the MBP); human-clicked commits mirror it.
  it('syncMbp: false never mirrors into the MBP but still records the version', async () => {
    const r = await commitDesignVersion(DB, args({ syncMbp: false }))
    expect(r.ok).toBe(true)
    expect(m.sync).not.toHaveBeenCalled()
    expect(m.insertVersion).toHaveBeenCalledTimes(1)
  })

  it('syncMbp: true mirrors the changed brand/design', async () => {
    m.apply.mockResolvedValue({ ...APPLIED, changedPaths: ['content/brand.json', 'content/design.json'] })
    await commitDesignVersion(DB, args({ syncMbp: true }))
    expect(m.sync).toHaveBeenCalledWith(DB, { sessionId: SID, jobId: 'job-1', brand: APPLIED.brand, design: APPLIED.design })
  })
})
