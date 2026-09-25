import { describe, it, expect } from 'vitest'
import { CURATED_FONTS } from '@/lib/content/type-pairing-catalog'
import { bundleFromRepoFiles } from './bundle-files'
import { DRAFT_FILES } from './__fixtures__/theme-texts'
import { DEFAULT_CAPABILITIES, type DesignCapabilities } from './run-types'
import { ChatWorkspace, FONTS_LOCKED_TOOL_ERROR } from './chat-workspace'
import { PREVIEWS_PER_TURN } from './chat-types'

const SHAS = { 'content/brand.json': 'a'.repeat(40), 'content/design.json': 'b'.repeat(40) }
const L2: DesignCapabilities = { level: 2, source: 'marker', templateVersion: '2', capabilities: ['fonts'] }
function current() {
  const r = bundleFromRepoFiles(DRAFT_FILES, { name: 'Harbor v3', source: 'chat' })
  if (!r.ok) throw new Error(r.errors.join(' '))
  return r.bundle
}
const ws = (over: Partial<ConstructorParameters<typeof ChatWorkspace>[0]> = {}) =>
  new ChatWorkspace({ current: current(), draftFiles: DRAFT_FILES, draftShas: SHAS, caps: DEFAULT_CAPABILITIES, model: 'claude-sonnet-5', ...over })

describe('ChatWorkspace edits', () => {
  it('stages a valid palette change as a chat bundle and bumps the revision', () => {
    const w = ws()
    const r = w.apply({ kind: 'palette', patch: { primary: '#123a5c' } })
    expect(r).toMatchObject({ ok: true, changed: true })
    expect(w.bundle().palette.primary).toBe('#123a5c')
    expect(w.bundle().name).toBe('Harbor v3')
    expect(w.bundle().meta).toEqual({ source: 'chat', model: 'claude-sonnet-5' })
    expect(w.revision()).toBe(1)
    expect(w.isStaged()).toBe(true)
    expect(w.pendingSummary()).toBe('palette (primary)')
  })
  it('a no-op edit changes nothing', () => {
    const w = ws()
    expect(w.apply({ kind: 'palette', patch: { primary: current().palette.primary } })).toMatchObject({ ok: true, changed: false })
    expect(w.isStaged()).toBe(false)
  })
  it('refuses a contrast-breaking palette and keeps the working copy', () => {
    const w = ws()
    const r = w.apply({ kind: 'palette', patch: { nearBlack: current().palette.nearWhite } })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/contrast/)
    expect(w.revision()).toBe(0)
  })
  it('refuses font changes below L2 with a clear message, allows them at L2', () => {
    const other = CURATED_FONTS.find((f) => f !== current().typography.headingFont) as string
    expect(ws().apply({ kind: 'fonts', patch: { headingFont: other } })).toEqual({ ok: false, error: FONTS_LOCKED_TOOL_ERROR })
    const w2 = ws({ caps: L2 })
    expect(w2.apply({ kind: 'fonts', patch: { headingFont: other } }).ok).toBe(true)
    expect(w2.bundle().typography.headingFont).toBe(other)
  })
  it('sanitizes block CSS and reports its budget; rejects unscoped CSS', () => {
    const w = ws()
    const r = w.apply({ kind: 'css', target: 'service-cards', css: '[data-block="service-cards"] .u-card { box-shadow: none; }' })
    expect(r).toMatchObject({ ok: true, changed: true })
    expect(r.ok && r.budget).toMatch(/^service-cards: \d+\/60 lines/)
    const bad = w.apply({ kind: 'css', target: 'service-cards', css: '.u-card { box-shadow: none; }' })
    expect(bad.ok).toBe(false)
    expect(w.revision()).toBe(1)
  })
})

describe('ChatWorkspace previews + commits', () => {
  it('allows PREVIEWS_PER_TURN preview slots', () => {
    const w = ws()
    for (let i = 0; i < PREVIEWS_PER_TURN; i++) expect(w.takePreviewSlot()).toBe(true)
    expect(w.takePreviewSlot()).toBe(false)
    expect(w.previewsUsed()).toBe(PREVIEWS_PER_TURN)
  })
  it('a preview only counts for the revision it rendered', () => {
    const w = ws()
    w.apply({ kind: 'palette', patch: { primary: '#123a5c' } })
    w.recordPreview({ metrics: null, baseline: null, shots: [] })
    expect(w.currentPreview()?.revision).toBe(1)
    w.apply({ kind: 'treatments', patch: { darkSections: !current().treatments.darkSections } })
    expect(w.currentPreview()).toBeNull()
  })
  it('markCommitted clears the staged state, moves the base shas and remembers the version', () => {
    const w = ws()
    w.apply({ kind: 'palette', patch: { primary: '#123a5c' } })
    const next = { ...SHAS, 'content/brand.json': 'c'.repeat(40) }
    w.markCommitted(next, 'ver-9')
    expect(w.isStaged()).toBe(false)
    expect(w.draftShas()).toEqual(next)
    expect(w.lastVersionId()).toBe('ver-9')
    expect(w.pendingSummary()).toBe('')
    // Later edits validate against the committed files.
    expect(w.apply({ kind: 'palette', patch: { action: '#0a7c86' } }).ok).toBe(true)
  })
  it('a preview recorded for an earlier revision (an edit landed mid-render) never gates the current copy', () => {
    const w = ws()
    w.apply({ kind: 'palette', patch: { primary: '#123a5c' } })
    const rendered = w.revision()
    w.apply({ kind: 'palette', patch: { action: '#0a7c86' } })
    w.recordPreview({ metrics: null, baseline: null, shots: [] }, rendered)
    expect(w.currentPreview()).toBeNull()
  })
  it('releasePreviewSlot hands back an unused slot', () => {
    const w = ws()
    w.takePreviewSlot()
    w.releasePreviewSlot()
    expect(w.previewsUsed()).toBe(0)
    w.releasePreviewSlot()
    expect(w.previewsUsed()).toBe(0)
  })
  it('markCommitted at an earlier revision keeps later edits staged (with their summaries)', () => {
    const w = ws()
    w.apply({ kind: 'palette', patch: { primary: '#123a5c' } })
    const at = { revision: w.revision(), bundle: w.bundle() }
    w.apply({ kind: 'treatments', patch: { darkSections: !current().treatments.darkSections } })
    w.markCommitted({ ...SHAS, 'content/brand.json': 'c'.repeat(40) }, 'ver-1', at)
    expect(w.isStaged()).toBe(true)
    expect(w.pendingSummary()).not.toContain('palette')
    expect(w.pendingSummary()).not.toBe('')
  })
  it('PF2: the base starts at the turn-start draft shas and follows each commit', () => {
    const w = ws()
    expect(w.draftShas()).toEqual(SHAS)
    w.apply({ kind: 'palette', patch: { primary: '#123a5c' } })
    const first = { ...SHAS, 'content/brand.json': 'c'.repeat(40) }
    w.markCommitted(first, 'ver-1')
    w.apply({ kind: 'palette', patch: { action: '#0a7c86' } })
    expect(w.draftShas()).toEqual(first)
    const second = { ...first, 'content/brand.json': 'd'.repeat(40) }
    w.markCommitted(second, null)
    expect(w.draftShas()).toEqual(second)
    expect(w.lastVersionId()).toBe('ver-1')
  })
  it('renders repo files without discarding hand-written CSS outside the managed region', () => {
    const legacy = '/* hand */\n[data-block="hero"] h1 { color: var(--color-primary); }\n'
    const w = ws({ draftFiles: { ...DRAFT_FILES, overridesCss: legacy } })
    w.apply({ kind: 'css', target: 'service-cards', css: '[data-block="service-cards"] { gap: 2rem; }' })
    const r = w.renderedFiles()
    expect(r.ok && r.files.overridesCss).toContain('/* hand */')
    expect(r.ok && r.files.overridesCss).toContain('design-studio:service-cards')
  })
})
