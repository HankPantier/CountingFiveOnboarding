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
  effective: vi.fn(),
  apply: vi.fn(),
  sync: vi.fn(async (..._a: unknown[]) => {}),
  insertVersion: vi.fn(),
  hasAnyVersion: vi.fn(),
  locks: vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
  updateSnapshot: vi.fn(async (..._a: unknown[]) => {}),
}))
vi.mock('./lock-store', () => ({
  listLocks: (...a: unknown[]) => m.locks(...a),
  updateLockSnapshot: (...a: unknown[]) => m.updateSnapshot(...a),
}))
vi.mock('./theme-snapshot', async (orig) => ({ ...((await orig()) as object), readDraftThemeSnapshot: (r: string) => m.snapshot(r), readThemeSnapshotAt: (r: string, s: unknown) => m.snapshotAt(r, s) }))
vi.mock('./capabilities-read', () => ({ readEffectiveCapabilities: (a: unknown) => m.effective(a) }))
vi.mock('./apply-bundle', () => ({ applyBundleToDraft: (a: unknown) => m.apply(a) }))
vi.mock('./sync-mbp-theme', () => ({ syncMbpTheme: (...a: unknown[]) => m.sync(...a) }))
vi.mock('./store', async (orig) => ({
  ...((await orig()) as object),
  insertVersion: (...a: unknown[]) => m.insertVersion(...a),
  hasAnyVersion: (...a: unknown[]) => m.hasAnyVersion(...a),
}))

import { VersionConflictError } from './store'
import {
  APPLIED_VERSION_NUMBER_UNRECORDED,
  APPLIED_VERSION_UNRECORDED,
  LEGACY_KEEP_UNCHECKED_ERROR,
  NO_BASELINE_ERROR,
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
  m.effective.mockResolvedValue({ draft: DEFAULT_CAPABILITIES, effective: DEFAULT_CAPABILITIES })
  m.apply.mockResolvedValue(APPLIED)
  m.insertVersion.mockResolvedValue(makeVersionRow({ id: 'ver-5', version_no: 5, source: 'chat' }))
  m.hasAnyVersion.mockResolvedValue(true)
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

  it('hands the apply a design.md rebuilder: the design direction for a concept / chat commit, none for a restore (WS-B)', async () => {
    const theme = { brand: JSON.parse(BRAND_TEXT), design: JSON.parse(DESIGN_TEXT) }
    await commitDesignVersion(DB, args({ source: 'concept', bundle: { ...VALID, name: 'Port Arthur Ledger' } }))
    const build = (m.apply.mock.calls[0][0] as { designMd: (b: unknown, d: unknown) => string }).designMd
    expect(build(theme.brand, theme.design)).toContain('**Port Arthur Ledger**')
    m.snapshot.mockReset().mockResolvedValue(BEFORE)
    await commitDesignVersion(DB, args({ source: 'revert' }))
    const restore = (m.apply.mock.calls[1][0] as { designMd: (b: unknown, d: unknown) => string }).designMd
    expect(restore(theme.brand, theme.design)).not.toContain('## Design direction')
  })

  // PF2: expectedShas is the base the caller built on. It is handed straight to
  // applyBundleToDraft (whose writeFiles sha guard is the ONLY staleness
  // check) — no snapshot-vs-expected pre-comparison that a lagging read could
  // false-409.
  it('refuses to commit while there is no v0 baseline (a failed import would make this commit v0)', async () => {
    m.hasAnyVersion.mockResolvedValue(false)
    const r = await commitDesignVersion(DB, args())
    expect(r).toEqual({ ok: false, status: 409, error: NO_BASELINE_ERROR })
    expect(m.apply).not.toHaveBeenCalled()
    expect(m.insertVersion).not.toHaveBeenCalled()
  })

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

  describe('fonts module (P6a: file contract = draft marker, gate = draft ∩ shell)', () => {
    const L2 = { level: 2 as const, source: 'marker' as const, templateVersion: '2026.09.1', capabilities: ['fonts'] }
    const FONTS = 'src/app/fonts.generated.ts'
    const otherFont = () => CURATED_FONTS.find((f) => f !== 'Public Sans' && f !== 'Fraunces') as string

    it('fonts unlocked at L2 (draft ∩ shell): apply writes the module and appliedBlobs records it', async () => {
      m.effective.mockResolvedValue({ draft: L2, effective: L2 })
      m.apply.mockResolvedValue({ ...APPLIED, blobs: { ...APPLIED.blobs, [FONTS]: '9'.repeat(40) }, changedPaths: [...APPLIED.changedPaths, FONTS] })
      const r = await commitDesignVersion(DB, args({ bundle: { ...VALID, typography: { ...VALID.typography, headingFont: otherFont() } } }))
      expect(r.ok).toBe(true)
      expect(m.apply.mock.calls[0][0]).toMatchObject({ fontsModule: true })
      const v = m.insertVersion.mock.calls[0][1] as { appliedBlobs: Record<string, string> }
      expect(v.appliedBlobs).toEqual({ ...AFTER_SHAS, 'content/brand.json': 'c'.repeat(40), [FONTS]: '9'.repeat(40) })
    })

    it('fonts locked when the live shell is L1: 422 and nothing applied', async () => {
      m.effective.mockResolvedValue({ draft: L2, effective: DEFAULT_CAPABILITIES })
      const r = await commitDesignVersion(DB, args({ bundle: { ...VALID, typography: { ...VALID.typography, headingFont: otherFont() } } }))
      expect(r).toMatchObject({ ok: false, status: 422 })
      expect(m.apply).not.toHaveBeenCalled()
    })

    it('L2 draft with an L1 shell and NO font change still writes/guards the module (file contract follows the draft)', async () => {
      m.effective.mockResolvedValue({ draft: L2, effective: DEFAULT_CAPABILITIES })
      const r = await commitDesignVersion(DB, args())
      expect(r.ok).toBe(true)
      expect(m.apply.mock.calls[0][0]).toMatchObject({ fontsModule: true })
    })

    it('L1 draft records four files: fontsModule false and no fonts key even if the snapshot has one', async () => {
      m.snapshot
        .mockReset()
        .mockResolvedValueOnce({ shas: { ...BEFORE_SHAS, [FONTS]: '8'.repeat(40) }, texts: BEFORE.texts })
        .mockResolvedValueOnce({ shas: { ...AFTER_SHAS, [FONTS]: '8'.repeat(40) }, texts: {} })
      const r = await commitDesignVersion(DB, args())
      expect(m.apply.mock.calls[0][0]).toMatchObject({ fontsModule: false })
      expect(r.ok && r.appliedBlobs).not.toHaveProperty(FONTS)
      const v = m.insertVersion.mock.calls[0][1] as { appliedBlobs: Record<string, string> }
      expect(v.appliedBlobs).not.toHaveProperty(FONTS)
    })

    it('skipIfUnchanged on an L2 draft returns the base map incl. the module', async () => {
      m.effective.mockResolvedValue({ draft: L2, effective: L2 })
      m.snapshot.mockReset().mockResolvedValue({ shas: { ...BEFORE_SHAS, [FONTS]: '8'.repeat(40) }, texts: BEFORE.texts })
      m.apply.mockResolvedValue({ ...APPLIED, commitSha: null, blobs: {}, changedPaths: [] })
      const r = await commitDesignVersion(DB, args({ skipIfUnchanged: true }))
      expect(r).toMatchObject({ ok: true, version: null, appliedBlobs: { ...BEFORE_SHAS, [FONTS]: '8'.repeat(40) } })
    })
  })

  describe('style axes below L3 (pre-P6b bundles keep the current axes)', () => {
    const L2 = { level: 2 as const, source: 'marker' as const, templateVersion: '2026.09.1', capabilities: ['fonts'] }
    const STYLED_DESIGN = JSON.stringify({ ...JSON.parse(DESIGN_TEXT), style: { cards: 'flat', nav: 'bordered' } }, null, 2)
    beforeEach(() => {
      m.effective.mockResolvedValue({ draft: L2, effective: L2 })
      m.snapshot.mockReset()
        .mockResolvedValueOnce({ shas: BEFORE_SHAS, texts: { ...BEFORE.texts, 'content/design.json': STYLED_DESIGN } })
        .mockResolvedValueOnce({ shas: AFTER_SHAS, texts: {} })
    })

    it('restoring a style-less version on an L2 site with axes applies + records the current axes (no 422, no wipe)', async () => {
      const { style: _none, ...styleLess } = VALID
      const r = await commitDesignVersion(DB, args({ source: 'revert', bundle: { ...styleLess, meta: { source: 'revert' } } }))
      expect(r.ok).toBe(true)
      expect((m.apply.mock.calls[0][0] as { bundle: { style?: unknown } }).bundle.style).toEqual({ cards: 'flat', nav: 'bordered' })
      expect((m.insertVersion.mock.calls[0][1] as { bundle: { style?: unknown } }).bundle.style).toEqual({ cards: 'flat', nav: 'bordered' })
    })

    it('applying a bundle that explicitly changes the style is still rejected below L3', async () => {
      const r = await commitDesignVersion(DB, args({ bundle: { ...VALID, style: { cards: 'elevated' }, meta: { source: 'concept' } } }))
      expect(r).toMatchObject({ ok: false, status: 422 })
      expect(m.apply).not.toHaveBeenCalled()
    })
  })

  describe('layout presets (2026.09.9 flag, effective tier)', () => {
    const LOCKED = { level: 4 as const, source: 'marker' as const, templateVersion: '2026.09.9', capabilities: ['fonts', 'style-axes', 'specimen'] }
    const UNLOCKED = { ...LOCKED, capabilities: [...LOCKED.capabilities, 'layout-presets'] }
    const LAID_DESIGN = JSON.stringify({ ...JSON.parse(DESIGN_TEXT), layout: { cards: 'list' } }, null, 2)
    beforeEach(() => {
      m.snapshot.mockReset()
        .mockResolvedValueOnce({ shas: BEFORE_SHAS, texts: { ...BEFORE.texts, 'content/design.json': LAID_DESIGN } })
        .mockResolvedValueOnce({ shas: AFTER_SHAS, texts: {} })
    })
    const appliedLayout = () => (m.apply.mock.calls[0][0] as { bundle: { layout?: unknown } }).bundle.layout
    const recordedLayout = () => (m.insertVersion.mock.calls[0][1] as { bundle: { layout?: unknown } }).bundle.layout

    it('locked site + a bundle that sets a layout → 422, nothing applied', async () => {
      m.effective.mockResolvedValue({ draft: UNLOCKED, effective: LOCKED })
      const r = await commitDesignVersion(DB, args({ bundle: { ...VALID, layout: { faq: 'split' }, meta: { source: 'concept' } } }))
      expect(r).toMatchObject({ ok: false, status: 422 })
      expect(r.ok === false && r.error).toContain('Layout presets are locked')
      expect(m.apply).not.toHaveBeenCalled()
    })
    it('locked restore of a pre-layout version keeps the draft layout (applied + recorded)', async () => {
      m.effective.mockResolvedValue({ draft: LOCKED, effective: LOCKED })
      const r = await commitDesignVersion(DB, args({ source: 'revert', bundle: { ...VALID, meta: { source: 'revert' } } }))
      expect(r.ok).toBe(true)
      expect(appliedLayout()).toEqual({ cards: 'list' })
      expect(recordedLayout()).toEqual({ cards: 'list' })
    })
    it('unlocked restore of a pre-layout version removes the layout (the bundle is the whole design)', async () => {
      m.effective.mockResolvedValue({ draft: UNLOCKED, effective: UNLOCKED })
      const r = await commitDesignVersion(DB, args({ source: 'revert', bundle: { ...VALID, meta: { source: 'revert' } } }))
      expect(r.ok).toBe(true)
      expect(appliedLayout()).toBeUndefined()
      expect(recordedLayout()).toBeUndefined()
    })
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

describe('commitDesignVersion — design locks (migration 085)', () => {
  const SNAP = { vars: { '--color-primary': 'hsl(1 2% 3%)' }, darkVars: {}, fonts: { heading: 'Lora', body: 'Inter', accent: 'Fraunces', display: 'heading' as const } }
  const AREA = { kind: 'area', key: 'service-cards', label: 'Service cards', snapshot: SNAP }
  const applied = () => m.apply.mock.calls[0][0] as { bundle: { palette: unknown; css: { locks?: string }; typography: { pinnedFonts?: string[] } } }

  it('a chat / concept commit keeps locked levers and writes the pins for locked areas', async () => {
    m.locks.mockResolvedValueOnce([{ kind: 'lever', key: 'palette', label: 'Palette', snapshot: null }, AREA])
    const current = JSON.parse(BRAND_TEXT) as { palette: Record<string, string> }
    await commitDesignVersion(DB, args({ bundle: { ...VALID, palette: { ...VALID.palette, primary: '#7a1f1f' }, meta: { source: 'chat' } } }))
    expect(applied().bundle.palette).toEqual(Object.fromEntries(Object.entries(current.palette).map(([k, v]) => [k, v.toLowerCase()])))
    expect(applied().bundle.css.locks).toContain(':where([data-block="service-cards"])')
    expect(applied().bundle.typography.pinnedFonts).toEqual(['Fraunces', 'Inter', 'Lora'])
    expect(m.updateSnapshot).not.toHaveBeenCalled()
  })

  it('a restore ignores the locks but re-freezes every locked area to the restored look', async () => {
    m.snapshot.mockReset().mockResolvedValue(BEFORE)
    m.locks.mockResolvedValueOnce([{ kind: 'lever', key: 'palette', label: 'Palette', snapshot: null }, AREA])
    const restored = { ...VALID, palette: { ...VALID.palette, primary: '#7a1f1f' }, meta: { source: 'revert' as const } }
    await commitDesignVersion(DB, args({ source: 'revert', bundle: restored }))
    expect(applied().bundle.palette).toEqual(restored.palette)
    expect(applied().bundle.css.locks).not.toContain('hsl(1 2% 3%)')
    expect(m.updateSnapshot).toHaveBeenCalledWith(DB, SID, 'service-cards', expect.objectContaining({ fonts: expect.objectContaining({ heading: 'Public Sans' }) }))
  })

  it('a verbatim restore gets today’s pins spliced into its recorded overrides file', async () => {
    m.snapshot.mockReset().mockResolvedValue(BEFORE)
    m.locks.mockResolvedValueOnce([AREA])
    await commitDesignVersion(DB, args({ source: 'revert', overridesVerbatim: '/* hand */\n[data-block="hero"] { color: red; }\n' }))
    const verbatim = (m.apply.mock.calls[0][0] as { overridesVerbatim: string }).overridesVerbatim
    expect(verbatim).toContain('[data-block="hero"] { color: red; }')
    expect(verbatim).toContain('/* design-studio:locks */')
  })
})
