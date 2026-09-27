import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import chroma from 'chroma-js'
import { addActionTextVars } from './add-action-text-vars'
import { hslTokensToHex } from './theme-css-generator'

const FIX = path.join(__dirname, '__fixtures__')
const read = (f: string) => readFileSync(path.join(FIX, f), 'utf-8')
// theme.css.golden BEFORE the action-text tokens (master 614e004) vs after.
const before = read('theme.css.pre-action-text.golden')
const golden = read('theme.css.golden')
// Live client theme.css files (2026-09-26). bblcpa's palette has drifted from
// its brand.json; Accord's primary #1F3A5F renders as #1f3a60 (hsl rounding).
const bblcpa = read('theme.css.bblcpa-2026-09-26.txt')
const accord = read('theme.css.accord-2026-09-26.txt')

const lines = (css: string) => css.split('\n')
const blocks = (css: string) => ({ light: css.slice(0, css.indexOf('.dark {')), dark: css.slice(css.indexOf('.dark {')) })
const tokOrNull = (blk: string, name: string) => blk.match(new RegExp(`\\n\\s*${name}: ([^;]+);`))?.[1] ?? null
const tok = (blk: string, name: string) => tokOrNull(blk, name)!
const painted = (blk: string, name: string) => {
  const v = tok(blk, name)
  return v.startsWith('#') ? v : hslTokensToHex(v)
}

// Every small-text token clears 4.5:1 on the surfaces the patched file PAINTS.
function expectRenderedAA(css: string) {
  const { light, dark } = blocks(css)
  for (const s of ['--color-background', '--color-muted', '--color-card'])
    expect(chroma.contrast(tok(light, '--color-action-text'), painted(light, s)), s).toBeGreaterThanOrEqual(4.5)
  expect(chroma.contrast(tok(light, '--color-action-on-primary'), painted(light, '--color-primary'))).toBeGreaterThanOrEqual(4.5)
  // Section ink paints var(--color-ink, var(--color-near-black)).
  const inkName = tokOrNull(light, '--color-ink') ? '--color-ink' : '--color-near-black'
  expect(chroma.contrast(tok(light, '--color-action-on-ink'), painted(light, inkName))).toBeGreaterThanOrEqual(4.5)
  const action = tok(light, '--color-action')
  for (const a of [0.1, 0.15]) {
    const tint = chroma.mix(painted(light, '--color-card'), action, a, 'rgb').hex()
    expect(chroma.contrast(tok(light, '--color-action-text-tint'), tint), `tint ${a}`).toBeGreaterThanOrEqual(4.5)
  }
  for (const s of ['--color-background', '--color-muted', '--color-card'])
    expect(chroma.contrast(tok(dark, '--color-action-text'), painted(dark, s)), `.dark ${s}`).toBeGreaterThanOrEqual(4.5)
}

describe('addActionTextVars', () => {
  it('turns the pre-token golden into EXACTLY the current generator output', () => {
    const r = addActionTextVars(before)
    expect(r.status).toBe('added')
    if (r.status !== 'added') return
    expect(r.css).toBe(golden)
    expect(r.dark).not.toBeNull()
  })

  it('is idempotent', () => {
    expect(addActionTextVars(golden)).toEqual({ status: 'unchanged', css: golden })
    const once = addActionTextVars(before)
    if (once.status !== 'added') throw new Error('expected added')
    expect(addActionTextVars(once.css).status).toBe('unchanged')
  })

  it('Accord: reads the file’s RENDERED primary — on-primary clears #1f3a60, not just the hex', () => {
    const r = addActionTextVars(accord)
    expect(r.status).toBe('added')
    if (r.status !== 'added') return
    expect(tok(blocks(accord).light, '--color-primary')).toBe('hsl(215 51% 25%)')
    expect(chroma.contrast(r.light.actionOnPrimary, '#1f3a60')).toBeGreaterThanOrEqual(4.5)
    expectRenderedAA(r.css)
  })

  it('only ADDS lines — every existing line is kept in order (bblcpa), AA on its rendered surfaces', () => {
    const r = addActionTextVars(bblcpa)
    expect(r.status).toBe('added')
    if (r.status !== 'added') return
    const out = lines(r.css)
    expect(lines(bblcpa).filter((l) => !out.includes(l))).toEqual([])
    expect(out.length - lines(bblcpa).length).toBe(2 * 11 + 4)
    expect(r.light.actionOnPrimary).toBe('#ff8e27')
    expectRenderedAA(r.css)
  })

  it('skips the dark overrides when the file predates dark mode', () => {
    const noDark = before.slice(0, before.indexOf('/* Dark mode.'))
    const r = addActionTextVars(noDark)
    expect(r.status).toBe('added')
    if (r.status === 'added') expect(r.dark).toBeNull()
  })

  it('refuses a file without a surface it must read', () => {
    const r = addActionTextVars(before.replace(/^\s*--color-muted: [^;]+;\n/gm, ''))
    expect(r).toEqual({ status: 'error', error: 'theme.css has no readable --color-muted (hsl() or #rrggbb)' })
  })

  it('refuses a partial older token set rather than stacking a second one', () => {
    const partial = before.replace('--color-action-foreground: #F7F5F2;\n', '--color-action-foreground: #F7F5F2;\n  --color-action-text: #007c90;\n')
    expect(addActionTextVars(partial).status).toBe('error')
  })
})
