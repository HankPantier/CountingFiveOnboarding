import { describe, it, expect } from 'vitest'
import { OVERRIDE_BLOCKS } from '@/lib/editor/theme-edit'
import { CHROME_COMPONENTS } from '../css-targets'
import { BLOCK_CATALOG, CHROME_CATALOG, blockCatalogHint } from './block-catalog'

describe('block catalog', () => {
  it('covers exactly the CSS-targetable blocks (so the model never styles an untargetable id)', () => {
    expect(BLOCK_CATALOG.map((b) => b.id).sort()).toEqual([...OVERRIDE_BLOCKS].sort())
  })
  it('covers exactly the chrome components', () => {
    expect(CHROME_CATALOG.map((c) => c.id).sort()).toEqual([...CHROME_COMPONENTS].sort())
  })
  it('the hint names every block and chrome component, deterministically', () => {
    const hint = blockCatalogHint()
    for (const b of BLOCK_CATALOG) expect(hint).toContain(`[data-block="${b.id}"]`)
    for (const c of CHROME_CATALOG) expect(hint).toContain(`[data-component="${c.id}"]`)
    expect(blockCatalogHint()).toBe(hint)
  })
})
