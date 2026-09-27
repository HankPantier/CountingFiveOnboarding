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
  // Tint badges: the 10% / 15% action tint over the page background AND the card, both themes.
  for (const [blk, label] of [[light, ''], [dark, '.dark ']] as const)
    for (const s of ['--color-background', '--color-card'])
      for (const a of [0.1, 0.15]) {
        const tint = chroma.mix(painted(blk, s), action, a, 'rgb').hex()
        expect(chroma.contrast(tok(blk, '--color-action-text-tint'), tint), `${label}tint ${a} over ${s}`).toBeGreaterThanOrEqual(4.5)
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

  it('refreshes ONLY a stale -text-tint value in a file that already has the full set (2026.09.4 rollout)', () => {
    // Simulate a client whose .dark background is LIGHTER than its card and whose
    // tint values were computed over the card only (the pre-fix rule).
    const { light, dark } = blocks(golden)
    const darkSwapped = dark
      .replace(/(\n\s*--color-background: )hsl\([^)]+\);/, '$1hsl(210 7% 21%);')
      .replace(/(\n\s*--color-action-text-tint: )[^;]+;/, '$1#00C1DE;')
    const stale = light + darkSwapped
    const r = addActionTextVars(stale)
    expect(r.status).toBe('updated')
    if (r.status !== 'updated') return
    const want = r.dark!.actionTextTint
    expect(want).not.toBe('#00C1DE')
    expect(r.changed).toEqual([`.dark #00C1DE → ${want}`])
    // Exactly one line differs — the .dark tint value.
    const a = lines(stale)
    const b = lines(r.css)
    expect(b.length).toBe(a.length)
    const diff = a.flatMap((l, i) => (l === b[i] ? [] : [[l, b[i]]]))
    expect(diff).toEqual([['  --color-action-text-tint: #00C1DE;', `  --color-action-text-tint: ${want};`]])
    expectRenderedAA(r.css)
    // Idempotent once refreshed.
    expect(addActionTextVars(r.css)).toEqual({ status: 'unchanged', css: r.css })
  })

  it('refreshes a stale LIGHT tint in every light block (@theme + :root) and leaves other tokens alone', () => {
    const stale = golden.replace(/(\n\s*--color-action-text-tint: )#007385;/g, '$1#0099b0;')
    expect(stale).not.toBe(golden)
    const r = addActionTextVars(stale)
    expect(r.status).toBe('updated')
    if (r.status !== 'updated') return
    expect(r.css).toBe(golden)
    expect(r.changed).toEqual(['#0099b0 → #007385', '#0099b0 → #007385'])
  })

  it('refuses a partial older token set rather than stacking a second one', () => {
    const partial = before.replace('--color-action-foreground: #F7F5F2;\n', '--color-action-foreground: #F7F5F2;\n  --color-action-text: #007c90;\n')
    expect(addActionTextVars(partial).status).toBe('error')
  })
})
