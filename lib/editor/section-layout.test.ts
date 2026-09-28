import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INK_TOGGLE_BLOCKS,
  layoutOptionsFor,
  setSectionLayoutByHeading,
  setSectionTheme,
  setSectionVariant,
  variantLabel,
} from './section-layout'
import { describeSections } from './section-reorder'
import { BLOCK_CATALOG } from '@/lib/content/block-catalog'

const FIX = path.join(__dirname, '__fixtures__', 'block-bodies')
const fixture = (name: string) => readFileSync(path.join(FIX, name), 'utf-8')

const ABRAMSON = fixture('abramson-contact.md')
const ACCORD = fixture('accord-succession-planning.md')
const AURORA_GS = fixture('aurora-getting-started.md')
const AURORA_PP = fixture('aurora-privacy-policy.md')

// Index (into describeSections().sections) of the first section with this block id.
function indexOf(body: string, blockId: string, nth = 0): number {
  const hits = describeSections(body)
    .sections.map((s, i) => (s.blockId === blockId ? i : -1))
    .filter((i) => i >= 0)
  if (hits[nth] === undefined) throw new Error(`no ${blockId} #${nth}`)
  return hits[nth]
}

// The lines that differ between two bodies of equal line count.
function changedLines(before: string, after: string): { line: number; from: string; to: string }[] {
  const a = before.split('\n')
  const b = after.split('\n')
  expect(b.length).toBe(a.length)
  return a.flatMap((from, i) => (from === b[i] ? [] : [{ line: i, from, to: b[i] }]))
}

describe('setSectionVariant', () => {
  it('flips a content-split image side, changing exactly its annotation line (fields kept in order)', () => {
    const i = indexOf(ABRAMSON, 'content-split')
    const res = setSectionVariant(ABRAMSON, i, 'image-left')
    expect(res.ok && res.changed).toBe(true)
    const diff = changedLines(ABRAMSON, res.body)
    expect(diff).toHaveLength(1)
    expect(diff[0].to).toBe(
      '<!-- block: content-split | variant: image-left | image: remote-client-video-call.jpg | alt: "Accountant on a video call with a remote client using a laptop" | query: "remote video call accountant client" -->',
    )
  })

  it('keeps the theme field last when changing the variant of an ink section', () => {
    const i = indexOf(ABRAMSON, 'industry-cards')
    const res = setSectionVariant(ABRAMSON, i, '4-col')
    const diff = changedLines(ABRAMSON, res.body)
    expect(diff).toEqual([
      expect.objectContaining({ to: '<!-- block: industry-cards | variant: 4-col | theme: ink -->' }),
    ])
  })

  it('adds a variant to a section that had none, in canonical position', () => {
    const body = ['<!-- block: stats-bar | theme: ink -->', '## Numbers', '', '- **20** years', ''].join('\n')
    const res = setSectionVariant(body, 0, '4-up')
    expect(res.body.split('\n')[0]).toBe('<!-- block: stats-bar | variant: 4-up | theme: ink -->')
    expect(res.body.split('\n').slice(1)).toEqual(body.split('\n').slice(1))
  })

  it('removes the variant with null', () => {
    const i = indexOf(ABRAMSON, 'cta-banner')
    const res = setSectionVariant(ABRAMSON, i, null)
    expect(changedLines(ABRAMSON, res.body)).toEqual([
      expect.objectContaining({ from: '<!-- block: cta-banner | variant: color-bg -->', to: '<!-- block: cta-banner -->' }),
    ])
  })

  it('is a byte-identical no-op when the value is already set (even with non-canonical spacing)', () => {
    const body = ['<!-- block: stats-bar | variant:4-up -->', '## Numbers', '', 'x', ''].join('\n')
    const res = setSectionVariant(body, 0, '4-up')
    expect(res).toEqual({ ok: true, body, changed: false })
  })

  it('keeps anything after the comment on the annotation line', () => {
    const body = ['<!-- block: intro-text | variant: centered -->  ', '## Hi', '', 'x', ''].join('\n')
    const res = setSectionVariant(body, 0, 'left-aligned')
    expect(res.body.split('\n')[0]).toBe('<!-- block: intro-text | variant: left-aligned -->  ')
  })

  it('never touches an unrecognised variant elsewhere on the page', () => {
    // aurora getting-started carries a legacy `content-table | variant: 2-col`.
    const i = indexOf(AURORA_GS, 'process-steps')
    const res = setSectionVariant(AURORA_GS, i, 'horizontal')
    const diff = changedLines(AURORA_GS, res.body)
    expect(diff).toHaveLength(1)
    expect(res.body).toContain('<!-- block: content-table | variant: 2-col -->')
  })

  it('leaves an unrecognised current value as-is when "re-picked", and can clear it explicitly', () => {
    const i = indexOf(AURORA_GS, 'content-table')
    expect(setSectionVariant(AURORA_GS, i, '2-col')).toEqual({ ok: true, body: AURORA_GS, changed: false })
    const cleared = setSectionVariant(AURORA_GS, i, null)
    expect(changedLines(AURORA_GS, cleared.body)).toEqual([
      expect.objectContaining({ to: '<!-- block: content-table -->' }),
    ])
  })

  it('refuses a value the block does not offer and returns the body unchanged', () => {
    const i = indexOf(ABRAMSON, 'content-split')
    const res = setSectionVariant(ABRAMSON, i, '4-col')
    expect(res.ok).toBe(false)
    expect(res.body).toBe(ABRAMSON)
    if (!res.ok) expect(res.reason).toMatch(/image-right, image-left/)
    const prose = setSectionVariant(ABRAMSON, indexOf(ABRAMSON, 'content-prose'), 'standard')
    expect(prose.ok).toBe(false)
  })

  it('refuses the FAQ, stray, non-strict, page-opener and out-of-range sections', () => {
    const faq = setSectionVariant(ABRAMSON, indexOf(ABRAMSON, 'faq-accordion'), 'grid')
    expect(faq).toMatchObject({ ok: false, body: ABRAMSON })

    // accord opens with a heading-less (stray) hero-split annotation.
    const stray = setSectionVariant(ACCORD, 0, 'image-left')
    expect(stray).toMatchObject({ ok: false, body: ACCORD })

    // An inline page-header followed by a heading: a page opener, not a section.
    const opener = setSectionVariant(AURORA_PP, indexOf(AURORA_PP, 'page-header'), null)
    expect(opener).toMatchObject({ ok: false, body: AURORA_PP })

    // Lenient-only annotations (unknown field, wrong field order) are never rewritten.
    for (const line of [
      '<!-- block: service-cards | variant: 3-col | foo: bar -->',
      '<!-- block: service-cards | theme: ink | variant: 3-col -->',
    ]) {
      const mangled = [line, '## Services', '', 'x', ''].join('\n')
      expect(describeSections(mangled).sections[0].parseable).toBe(false)
      expect(setSectionVariant(mangled, 0, '2-col')).toMatchObject({ ok: false, body: mangled })
      expect(setSectionTheme(mangled, 0, null)).toMatchObject({ ok: false, body: mangled })
    }

    expect(setSectionVariant(ABRAMSON, 999, 'image-left')).toMatchObject({ ok: false, body: ABRAMSON })
  })

  it('ignores the pinned lead-in when indexing', () => {
    const body = ['Lead-in prose.', '', '<!-- block: intro-text -->', '## Hi', '', 'x', ''].join('\n')
    const res = setSectionVariant(body, 0, 'left-aligned')
    expect(res.body).toBe(body.replace('<!-- block: intro-text -->', '<!-- block: intro-text | variant: left-aligned -->'))
  })
})

describe('setSectionTheme', () => {
  it('turns the ink band on and off on exactly one line', () => {
    const body = ['<!-- block: service-cards | variant: 2-col -->', '## Services', '', '### Tax', ''].join('\n')
    const on = setSectionTheme(body, 0, 'ink')
    expect(changedLines(body, on.body)).toEqual([
      expect.objectContaining({ to: '<!-- block: service-cards | variant: 2-col | theme: ink -->' }),
    ])
    const off = setSectionTheme(on.body, 0, null)
    expect(off.body).toBe(body)
  })

  it('refuses a theme the block does not support', () => {
    const i = indexOf(ABRAMSON, 'content-split')
    expect(setSectionTheme(ABRAMSON, i, 'ink')).toMatchObject({ ok: false, body: ABRAMSON })
  })
})

describe('layoutOptionsFor', () => {
  it('offers the catalog values, the default marked, current = written value', () => {
    const o = layoutOptionsFor('team-grid', { variant: '4-col', theme: '' })
    expect(o.options.map((x) => x.value)).toEqual(['2-col', '3-col', '4-col'])
    expect(o.options.find((x) => x.value === '3-col')?.label).toBe('3 columns (default)')
    expect(o).toMatchObject({ current: '4-col', currentRecognised: true, showLayout: true, ink: null })
  })

  it('falls back to the template default when no variant is written', () => {
    expect(layoutOptionsFor('process-steps', { variant: '', theme: '' }).current).toBe('vertical')
  })

  it('flags an unrecognised value instead of rewriting it', () => {
    const o = layoutOptionsFor('service-cards', { variant: 'default', theme: '' })
    expect(o.current).toBe('default')
    expect(o.currentRecognised).toBe(false)
    expect(o.options[0]).toEqual({ value: 'default', label: 'default (not recognised)', recognised: false })
    expect(o.showLayout).toBe(true)
  })

  it('hides the select for single-layout blocks, but still flags a stray variant on them', () => {
    expect(layoutOptionsFor('content-prose', { variant: '', theme: '' }).showLayout).toBe(false)
    const o = layoutOptionsFor('content-table', { variant: '2-col', theme: '' })
    expect(o.showLayout).toBe(true)
    expect(o.options.map((x) => x.value)).toEqual(['2-col', ''])
  })

  it('offers the ink toggle only where it is visible, with a layout note on grids that re-flow', () => {
    expect(INK_TOGGLE_BLOCKS.every((id) => (BLOCK_CATALOG as Record<string, { themes: readonly string[] }>)[id].themes.includes('ink'))).toBe(true)
    expect(layoutOptionsFor('service-cards', { variant: '', theme: 'ink' }).ink).toEqual({ on: true })
    expect(layoutOptionsFor('industry-cards', { variant: '', theme: '' }).ink).toMatchObject({ on: false, note: expect.any(String) })
    expect(layoutOptionsFor('feature-grid', { variant: '', theme: '' }).ink?.note).toBeTruthy()
    // The catalog accepts ink here, but it makes no visible difference.
    expect(layoutOptionsFor('cta-banner', { variant: '', theme: 'ink' }).ink).toBeNull()
    expect(layoutOptionsFor('stats-bar', { variant: '', theme: '' }).ink).toBeNull()
  })

  it('reports a theme the block does not accept', () => {
    expect(layoutOptionsFor('stats-bar', { variant: '', theme: 'light' }).unrecognisedTheme).toBe('light')
    expect(layoutOptionsFor('stats-bar', { variant: '', theme: 'ink' }).unrecognisedTheme).toBeUndefined()
  })

  it('offers nothing for page openers', () => {
    expect(layoutOptionsFor('hero-split', { variant: '', theme: '' }).showLayout).toBe(false)
  })

  it('labels unknown values readably', () => {
    expect(variantLabel('with-image-left')).toBe('Image left')
    expect(variantLabel('some-new-thing')).toBe('Some new thing')
  })
})

describe('setSectionLayoutByHeading', () => {
  const BODY = [
    '<!-- block: intro-text | variant: centered -->',
    '## Welcome',
    '',
    'Hi.',
    '',
    '<!-- block: service-cards | variant: 3-col -->',
    '## Our **Services**',
    '',
    '### Tax',
    '',
    '<!-- block: stats-bar -->',
    '## Numbers',
    '',
    '- **20** years',
    '',
    '<!-- block: content-prose -->',
    '## Numbers',
    '',
    'Dup.',
    '',
  ].join('\n')

  it('sets variant and theme on the named section in one line', () => {
    const res = setSectionLayoutByHeading(BODY, 'our **services**', { variant: '2-col', theme: 'ink' })
    expect(res).toMatchObject({ ok: true, changed: true, blockId: 'service-cards' })
    expect(changedLines(BODY, res.body)).toEqual([
      expect.objectContaining({ to: '<!-- block: service-cards | variant: 2-col | theme: ink -->' }),
    ])
  })

  it('removes a theme with null and reports a no-op', () => {
    const on = setSectionLayoutByHeading(BODY, 'Our Services', { theme: 'ink' })
    expect(setSectionLayoutByHeading(on.body, 'Our Services', { theme: null }).body).toBe(BODY)
    expect(setSectionLayoutByHeading(BODY, 'Welcome', { variant: 'centered' })).toMatchObject({ ok: true, changed: false, body: BODY })
  })

  it('refuses unknown, ambiguous and empty requests, and an invalid half, leaving the body unchanged', () => {
    expect(setSectionLayoutByHeading(BODY, 'Pricing', { variant: '2-col' })).toMatchObject({ ok: false, body: BODY })
    expect(setSectionLayoutByHeading(BODY, 'Numbers', { variant: '4-up' })).toMatchObject({ ok: false, body: BODY })
    expect(setSectionLayoutByHeading(BODY, 'Welcome', {})).toMatchObject({ ok: false, body: BODY })
    // A valid variant with an unsupported theme: nothing is applied.
    expect(setSectionLayoutByHeading(BODY, 'Welcome', { variant: 'left-aligned', theme: 'ink' })).toMatchObject({ ok: false, body: BODY })
  })
})
