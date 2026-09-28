import { describe, expect, it, vi } from 'vitest'

// Pretend `statement` ships in a later template release, so an older site's
// select must not offer it — yet a page already using it stays visible.
vi.mock('@/lib/content/block-catalog', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/content/block-catalog')>()
  const hero = {
    ...orig.BLOCK_CATALOG.hero,
    variants: orig.BLOCK_CATALOG.hero.variants.map((v) => (v.value === 'statement' ? { ...v, since: '2026.09.9' } : v)),
  }
  return { ...orig, blockSpec: (id: string) => (id === 'hero' ? hero : orig.blockSpec(id)) }
})

const { pageOpenerSelectState } = await import('./page-opener')
const { splitFile } = await import('./frontmatter')

const fm = (lines: string[]) => splitFile(['---', ...lines, '---', '', 'Body.', ''].join('\n')).frontmatter!

describe('page opener select across template versions', () => {
  it('keeps a current choice the template does not offer visible as a custom row', () => {
    const st = pageOpenerSelectState(fm(['hero: hero', 'hero_variant: statement']), '2026.09.8')
    expect(st.choices.map((c) => c.id)).not.toContain('statement')
    expect(st.value).toBe('__custom')
    expect(st.customLabel).toMatch(/^Custom: Statement/)
  })

  it('offers and selects it on a template that has it', () => {
    const st = pageOpenerSelectState(fm(['hero: hero', 'hero_variant: statement']), '2026.09.9')
    expect(st.value).toBe('statement')
    expect(st.customLabel).toBeUndefined()
  })
})
