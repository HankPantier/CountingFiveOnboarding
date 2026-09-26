import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { SID, makeInputRow, makeVersionListRow, makeVersionRow } from '@/lib/design/__fixtures__/rows'
import { MALFORMED_REGION_ERROR } from '@/lib/design/bundle-files'
import { asJson } from '@/lib/supabase/json-typed'
import { DEFAULT_CAPABILITIES } from '@/lib/design/run-types'
import { generateFontsModule } from '@/lib/content/font-module-generator'
import { normalizeTypography } from '@/app/api/edit/[id]/theme/_theme'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  snapshot: vi.fn(),
  readSessionSchema: vi.fn(),
  listInputs: vi.fn(),
  listVersions: vi.fn(),
  getBaselineOrCreate: vi.fn(),
  sign: vi.fn(async (_s: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`]))),
  loadRun: vi.fn(),
  caps: vi.fn(),
}))

vi.mock('./_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/theme-snapshot', () => ({ readDraftThemeSnapshot: (repo: string) => m.snapshot(repo) }))
vi.mock('@/lib/design/store', () => ({
  readSessionSchema: (...a: unknown[]) => m.readSessionSchema(...a),
  listInputs: (...a: unknown[]) => m.listInputs(...a),
  listVersions: (...a: unknown[]) => m.listVersions(...a),
  getBaselineOrCreate: (...a: unknown[]) => m.getBaselineOrCreate(...a),
}))
vi.mock('@/lib/design/storage', () => ({ signDesignPaths: (s: unknown, p: string[]) => m.sign(s, p) }))
vi.mock('@/lib/design/capabilities-read', () => ({ readDesignCapabilities: (repo: string) => m.caps(repo) }))
vi.mock('@/lib/design/run-view', () => ({ loadLatestRunDto: (...a: unknown[]) => m.loadRun(...a) }))

import { GET } from './route'

const FIX = path.join(process.cwd(), 'lib', 'content', '__fixtures__')
const TEXTS = {
  'content/brand.json': readFileSync(path.join(FIX, 'brand.golden.json'), 'utf-8'),
  'content/design.json': readFileSync(path.join(FIX, 'design.golden.json'), 'utf-8'),
  'src/styles/theme.css': readFileSync(path.join(FIX, 'theme.css.golden'), 'utf-8'),
}
const SHAS = { 'content/brand.json': 'a'.repeat(40), 'content/design.json': 'b'.repeat(40), 'src/styles/theme.css': 'c'.repeat(40) }
const THUMB = `design/${SID}/inputs/a.webp`

const call = () => GET(new Request('http://x/api'), { params: Promise.resolve({ id: SID }) })

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.gate.mockReset().mockResolvedValue({ sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.snapshot.mockReset().mockResolvedValue({ shas: SHAS, texts: TEXTS })
  m.readSessionSchema.mockReset().mockResolvedValue({ websiteUrl: 'bblcpa.com', business: { competitors: [{ name: 'Acme CPA' }] } })
  m.listInputs.mockReset().mockResolvedValue([makeInputRow({ storage_path: THUMB, capture_status: 'ok' })])
  m.listVersions.mockReset().mockResolvedValue([makeVersionListRow({ applied_blobs: asJson(SHAS) })])
  m.getBaselineOrCreate.mockReset().mockResolvedValue({ status: 'created', latest: makeVersionRow({ applied_blobs: asJson(SHAS) }) })
  m.loadRun.mockReset().mockResolvedValue(null)
  m.caps.mockReset().mockResolvedValue(DEFAULT_CAPABILITIES)
})

describe('GET /design', () => {
  it('returns the gate response for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await call()
    expect(res.status).toBe(403)
    expect(m.snapshot).not.toHaveBeenCalled()
  })

  it('imports the draft as baseline v0 and returns the full state', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    const args = m.getBaselineOrCreate.mock.calls[0][1] as { sessionId: string; createdBy: string; appliedBlobs: unknown; source: { ok: boolean; bundle?: { meta: { source: string } } } }
    expect(args.sessionId).toBe(SID)
    expect(args.createdBy).toBe('admin-1')
    expect(args.appliedBlobs).toEqual(SHAS)
    expect(args.source.ok).toBe(true)
    expect(args.source.bundle?.meta.source).toBe('baseline')
    expect(body.baseline).toEqual({ status: 'ok', created: true })
    expect(body.drift).toEqual({ status: 'in-sync', changedPaths: [], sinceVersion: 0 })
    expect(body.themeCssStale).toBe(false)
    expect(body.versions).toHaveLength(1)
    expect(body.latest.versionNo).toBe(0)
    expect(body.inputs[0].thumbnailUrl).toBe(`https://signed/${THUMB}`)
    expect(body.suggestions).toEqual({ currentSite: 'https://bblcpa.com/', competitors: [{ name: 'Acme CPA' }] })
  })

  it('reports a baseline import failure without failing the load', async () => {
    m.snapshot.mockResolvedValue({ shas: SHAS, texts: { ...TEXTS, 'content/design-overrides.css': '/* design-studio:begin */\n' } })
    m.getBaselineOrCreate.mockResolvedValue({ status: 'error', error: MALFORMED_REGION_ERROR })
    m.listVersions.mockResolvedValue([])
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(m.getBaselineOrCreate.mock.calls[0][1].source).toEqual({ ok: false, errors: [MALFORMED_REGION_ERROR] })
    expect(body.baseline).toEqual({ status: 'error', error: MALFORMED_REGION_ERROR })
    expect(body.drift.status).toBe('no-baseline')
    expect(body.latest).toBeNull()
  })

  it('reports missing brand/design files as a baseline error source', async () => {
    m.snapshot.mockResolvedValue({ shas: {}, texts: {} })
    m.getBaselineOrCreate.mockResolvedValue({ status: 'error', error: 'x' })
    m.listVersions.mockResolvedValue([])
    await call()
    const source = m.getBaselineOrCreate.mock.calls[0][1].source as { ok: false; errors: string[] }
    expect(source.ok).toBe(false)
    expect(source.errors[0]).toContain('no brand.json')
  })

  it('flags drift since the latest version', async () => {
    m.getBaselineOrCreate.mockResolvedValue({ status: 'existing', latest: makeVersionRow() })
    m.listVersions.mockResolvedValue([makeVersionListRow({ version_no: 1, applied_blobs: asJson({ ...SHAS, 'src/styles/theme.css': 'f'.repeat(40) }) })])
    const body = await (await call()).json()
    expect(body.baseline).toEqual({ status: 'ok', created: false })
    expect(body.drift).toEqual({ status: 'drifted', changedPaths: ['src/styles/theme.css'], sinceVersion: 1 })
  })

  it('flags a stale theme.css', async () => {
    m.snapshot.mockResolvedValue({ shas: SHAS, texts: { ...TEXTS, 'src/styles/theme.css': ':root{}' } })
    expect((await (await call()).json()).themeCssStale).toBe(true)
  })

  it('continues with null thumbnails when signing fails, instead of 500', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    m.sign.mockRejectedValueOnce(new Error('storage down'))
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inputs[0].thumbnailUrl).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('hides raw errors behind a generic 500', async () => {
    m.listInputs.mockRejectedValue(new Error('relation "design_inputs" does not exist'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to load the Design Studio' })
  })

  it('includes the latest design run', async () => {
    m.loadRun.mockResolvedValue({ id: 'run-1', status: 'ready' })
    const body = await (await call()).json()
    expect(body.run).toEqual({ id: 'run-1', status: 'ready' })
  })

  it('still loads when the latest run cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    m.loadRun.mockRejectedValue(new Error('db'))
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).run).toBeNull()
  })

  describe('fonts module (L2+ drafts)', () => {
    const L2 = { level: 2, source: 'marker', templateVersion: '2026.09.1', capabilities: ['fonts'] }
    const FONTS = 'src/app/fonts.generated.ts'
    const FONTS_SHA = 'f'.repeat(40)

    it('fontsModuleStale is true when the module does not match design.json on an L2 draft', async () => {
      m.caps.mockResolvedValue(L2)
      m.snapshot.mockResolvedValue({ shas: { ...SHAS, [FONTS]: FONTS_SHA }, texts: { ...TEXTS, [FONTS]: generateFontsModule().source } })
      const body = await (await call()).json()
      expect(m.caps).toHaveBeenCalledWith('o/r')
      expect(body.fontsModuleStale).toBe(true)
      // v0 records the module on L2 drafts (the applied_blobs contract).
      const args = m.getBaselineOrCreate.mock.calls[0][1] as { appliedBlobs: unknown }
      expect(args.appliedBlobs).toEqual({ ...SHAS, [FONTS]: FONTS_SHA })
    })

    it('fontsModuleStale is false when the module matches design.json on an L2 draft', async () => {
      m.caps.mockResolvedValue(L2)
      const design = JSON.parse(TEXTS['content/design.json']) as { typography?: Record<string, string> }
      const fresh = generateFontsModule(normalizeTypography(design.typography)).source
      m.snapshot.mockResolvedValue({ shas: { ...SHAS, [FONTS]: FONTS_SHA }, texts: { ...TEXTS, [FONTS]: fresh } })
      expect((await (await call()).json()).fontsModuleStale).toBe(false)
    })

    it('fontsModuleStale is null on an L1 draft, and v0 / drift ignore the module there', async () => {
      m.snapshot.mockResolvedValue({ shas: { ...SHAS, [FONTS]: FONTS_SHA }, texts: { ...TEXTS, [FONTS]: generateFontsModule().source } })
      const body = await (await call()).json()
      expect(body.fontsModuleStale).toBeNull()
      const args = m.getBaselineOrCreate.mock.calls[0][1] as { appliedBlobs: unknown }
      expect(args.appliedBlobs).toEqual(SHAS)
      expect(body.drift.status).toBe('in-sync')
    })

    it('an L2 draft drifts when the module changed after a version that recorded it', async () => {
      m.caps.mockResolvedValue(L2)
      m.listVersions.mockResolvedValue([makeVersionListRow({ applied_blobs: asJson({ ...SHAS, [FONTS]: '1'.repeat(40) }) })])
      m.snapshot.mockResolvedValue({ shas: { ...SHAS, [FONTS]: FONTS_SHA }, texts: TEXTS })
      const body = await (await call()).json()
      expect(body.drift).toMatchObject({ status: 'drifted', changedPaths: [FONTS] })
    })
  })
})
