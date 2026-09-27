import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import chroma from 'chroma-js'
import { addActionTextVars } from './add-action-text-vars'

const FIX = path.join(__dirname, '__fixtures__')
const read = (f: string) => readFileSync(path.join(FIX, f), 'utf-8')
// theme.css.golden BEFORE the action-text tokens (master 614e004) vs after.
const before = read('theme.css.pre-action-text.golden')
const golden = read('theme.css.golden')
// bblcpa's live theme.css (2026-09-26) — carries a palette that has drifted
// from its brand.json in other respects, which is why the helper patches in place.
const bblcpa = read('theme.css.bblcpa-2026-09-26.txt')

const lines = (css: string) => css.split('\n')

describe('addActionTextVars', () => {
  it('turns the pre-token golden into EXACTLY the current generator output', () => {
    const r = addActionTextVars(before)
    expect(r.status).toBe('added')
    if (r.status !== 'added') return
    expect(r.css).toBe(golden)
    expect(r.darkBlock).toBe(true)
  })

  it('is idempotent', () => {
    expect(addActionTextVars(golden)).toEqual({ status: 'unchanged', css: golden })
    const once = addActionTextVars(before)
    if (once.status !== 'added') throw new Error('expected added')
    expect(addActionTextVars(once.css).status).toBe('unchanged')
  })

  it('only ADDS lines — every existing line is kept in order (bblcpa)', () => {
    const r = addActionTextVars(bblcpa)
    expect(r.status).toBe('added')
    if (r.status !== 'added') return
    const out = lines(r.css)
    const removed = lines(bblcpa).filter((l) => !out.includes(l))
    expect(removed).toEqual([])
    expect(out.length - lines(bblcpa).length).toBe(2 * 5 + 2)
    // bblcpa: #ff8e27 on #FeFefe (2.29:1) → corrected; on its navy primary it already passes.
    expect(chroma.contrast(r.colors.actionText, '#FeFefe')).toBeGreaterThanOrEqual(4.5)
    expect(r.colors.actionOnPrimary).toBe('#ff8e27')
    expect(r.css).toContain(`--color-action-text: ${r.colors.actionText};`)
    expect(r.css).toMatch(/\.dark \{[\s\S]*--color-action-text: #ff8e27;\n\}/)
  })

  it('skips the dark override when the file predates dark mode', () => {
    const noDark = before.slice(0, before.indexOf('/* Dark mode.'))
    const r = addActionTextVars(noDark)
    expect(r.status).toBe('added')
    if (r.status === 'added') expect(r.darkBlock).toBe(false)
  })

  it('refuses a file without the palette tokens it derives from', () => {
    const r = addActionTextVars(before.replace(/^\s*--color-primary-hex: [^;]+;\n/gm, ''))
    expect(r).toEqual({ status: 'error', error: 'theme.css has no #rrggbb value for palette.primary' })
  })
})
