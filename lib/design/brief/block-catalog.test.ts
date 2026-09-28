import { describe, it, expect } from 'vitest'
import { OVERRIDE_BLOCKS } from '@/lib/editor/theme-edit'
import { BLOCK_IDS, blockVariantValuesAt } from '@/lib/content/block-catalog'
import { CHROME_COMPONENTS } from '../css-targets'
import { CHROME_CATALOG, STYLING_HOOKS_SINCE, blockCatalog, blockCatalogHint, chromeCatalog, vocabularyEpoch } from './block-catalog'

const V = '2026.09.8'
const LATEST = STYLING_HOOKS_SINCE

describe('block catalog', () => {
  it('covers exactly the CSS-targetable blocks at the latest template (so the model never styles an untargetable id)', () => {
    expect(blockCatalog(LATEST).map((b) => b.id).sort()).toEqual([...OVERRIDE_BLOCKS].sort())
    expect(chromeCatalog(LATEST).map((c) => c.id).sort()).toEqual([...CHROME_COMPONENTS].sort())
  })
  it('hides the 2026.09.11 hooks from sites whose template lacks them', () => {
    const hooks = ['resource-browser', 'post-image', 'post-body', 'related-posts', 'not-found']
    for (const id of hooks) expect(blockCatalog('2026.09.10').map((b) => b.id)).not.toContain(id)
    for (const id of ['topbar', 'contact-drawer', 'section-nav']) expect(chromeCatalog('2026.09.10').map((c) => c.id)).not.toContain(id)
    expect(blockCatalogHint('2026.09.10')).not.toContain('[data-component="topbar"]')
    expect(blockCatalogHint(LATEST)).toContain('[data-component="topbar"]')
    expect(blockCatalogHint(LATEST)).toContain('[data-block="resource-browser"]')
    expect(vocabularyEpoch('2026.09.10')).not.toBe(vocabularyEpoch(LATEST))
    expect(vocabularyEpoch('2026.10.1')).toBe(LATEST)
  })
  it('covers exactly the chrome components', () => {
    expect(CHROME_CATALOG.map((c) => c.id).sort()).toEqual([...CHROME_COMPONENTS].sort())
  })
  it('the hint names every block and chrome component, deterministically', () => {
    const hint = blockCatalogHint(LATEST)
    for (const b of blockCatalog(LATEST)) expect(hint).toContain(`[data-block="${b.id}"]`)
    for (const c of CHROME_CATALOG) expect(hint).toContain(`[data-component="${c.id}"]`)
    expect(blockCatalogHint(LATEST)).toBe(hint)
  })
  // client-center is platform chrome; answer-callout / related-links /
  // trust-signals are page furniture the template renders on every generated
  // page (not markdown-authorable blocks), so none of them has variants.
  it('takes every variant list from the template contract at the given version (non-authorable blocks have none)', () => {
    for (const b of blockCatalog(V)) expect(b.variants, b.id).toEqual(blockVariantValuesAt(b.id, V))
    const contractIds = new Set<string>(BLOCK_IDS)
    expect(blockCatalog(V).filter((b) => !contractIds.has(b.id)).map((b) => b.id)).toEqual(['client-center', 'answer-callout', 'related-links', 'trust-signals'])
    expect(blockCatalog(V).find((b) => b.id === 'checklist-section')?.variants).toContain('with-image-left')
  })
  it('is byte-identical for every version in the same catalog epoch (no marker = baseline)', () => {
    expect(blockCatalogHint(null)).toBe(blockCatalogHint(V))
    expect(blockCatalogHint('garbage')).toBe(blockCatalogHint(V))
  })
})
