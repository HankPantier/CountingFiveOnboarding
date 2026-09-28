import { describe, it, expect } from 'vitest'
import { OVERRIDE_BLOCKS } from '@/lib/editor/theme-edit'
import { BLOCK_IDS, blockVariantValuesAt } from '@/lib/content/block-catalog'
import { CHROME_COMPONENTS } from '../css-targets'
import { CHROME_CATALOG, blockCatalog, blockCatalogHint } from './block-catalog'

const V = '2026.09.8'

describe('block catalog', () => {
  it('covers exactly the CSS-targetable blocks (so the model never styles an untargetable id)', () => {
    expect(blockCatalog(V).map((b) => b.id).sort()).toEqual([...OVERRIDE_BLOCKS].sort())
  })
  it('covers exactly the chrome components', () => {
    expect(CHROME_CATALOG.map((c) => c.id).sort()).toEqual([...CHROME_COMPONENTS].sort())
  })
  it('the hint names every block and chrome component, deterministically', () => {
    const hint = blockCatalogHint(V)
    for (const b of blockCatalog(V)) expect(hint).toContain(`[data-block="${b.id}"]`)
    for (const c of CHROME_CATALOG) expect(hint).toContain(`[data-component="${c.id}"]`)
    expect(blockCatalogHint(V)).toBe(hint)
  })
  it('takes every variant list from the template contract at the given version (client-center is platform chrome)', () => {
    for (const b of blockCatalog(V)) expect(b.variants, b.id).toEqual(blockVariantValuesAt(b.id, V))
    const contractIds = new Set<string>(BLOCK_IDS)
    expect(blockCatalog(V).filter((b) => !contractIds.has(b.id)).map((b) => b.id)).toEqual(['client-center'])
    expect(blockCatalog(V).find((b) => b.id === 'checklist-section')?.variants).toContain('with-image-left')
  })
  it('is byte-identical for every version in the same catalog epoch (no marker = baseline)', () => {
    expect(blockCatalogHint(null)).toBe(blockCatalogHint(V))
    expect(blockCatalogHint('garbage')).toBe(blockCatalogHint(V))
  })
})
