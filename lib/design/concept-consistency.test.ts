import { describe, it, expect } from 'vitest'
import { CURATED_FONTS } from '@/lib/content/type-pairing-catalog'
import { VALID } from './__fixtures__/valid-bundle'
import type { DesignBundle } from './bundle'
import { parseTemplateMarker } from './capabilities'
import { CLAIM_CHECK_PREFIX, SERIF_FONTS, SIGNATURE_CSS_PREFIX, claimClauses, conceptConsistencyNotes } from './concept-consistency'
import { DEFAULT_CAPABILITIES } from './run-types'

const L1 = DEFAULT_CAPABILITIES
const L2 = parseTemplateMarker('{"capabilities":["fonts"]}')
const L3 = parseTemplateMarker('{"capabilities":["fonts","style-axes"]}')
const TWO_BLOCKS = { blocks: { hero: '[data-block="hero"] h1 { letter-spacing: -0.02em; }', 'service-cards': '[data-block="service-cards"] h3 { font-weight: 600; }' } }
// A clean baseline: says nothing, sets sans / standard / no dark sections, two signature blocks.
const BASE: DesignBundle = {
  ...VALID,
  name: 'Harbor',
  tagline: 'Calm authority',
  rationale: 'Trustworthy and modern.',
  moves: [],
  treatments: { headlineStyle: 'sans', eyebrowStyle: 'standard', darkSections: false },
  css: TWO_BLOCKS,
}
const says = (moves: string[], over: Partial<DesignBundle> = {}): DesignBundle => ({ ...BASE, moves, ...over })
const claims = (b: DesignBundle, caps = L3) => conceptConsistencyNotes(b, caps).filter((n) => n.startsWith(CLAIM_CHECK_PREFIX))

describe('conceptConsistencyNotes — treatments', () => {
  it('a clean concept has no notes', () => expect(conceptConsistencyNotes(BASE, L3)).toEqual([]))

  it('"serif" headline claims need headlineStyle serif or a serif heading font', () => {
    for (const m of ['Serif editorial headlines', 'Headlines set in a high-contrast serif', 'serif display headline']) {
      expect(claims(says([m]))).toEqual([expect.stringContaining('promises serif headlines')])
    }
    expect(claims(says(['Serif editorial headlines'], { treatments: { ...BASE.treatments, headlineStyle: 'serif' } }))).toEqual([])
    expect(claims(says(['Serif editorial headlines'], { typography: { ...BASE.typography, headingFont: 'Playfair Display' } }))).toEqual([])
  })
  it('never reads the serif accent role, sans-serif or a negation as a serif-headline claim', () => {
    for (const m of ['Grotesk display + serif-accent contrast', 'A serif accent word in every headline', 'Sans-serif headlines throughout', 'Headlines stay sans with a serif accent', 'No serif headlines']) {
      expect(claims(says([m]))).toEqual([])
    }
  })
  it('suggests a serif heading font only where fonts are unlocked', () => {
    expect(claims(says(['Serif headlines']), L2)[0]).toContain('serif headingFont')
    expect(claims(says(['Serif headlines']), L1)[0]).not.toContain('serif headingFont')
  })
  it('"mono" eyebrow claims need eyebrowStyle mono', () => {
    expect(claims(says(['Mono small-caps kickers']))).toEqual([expect.stringContaining('mono eyebrows')])
    expect(claims(says(['Eyebrows in monospace']))).toEqual([expect.stringContaining('mono eyebrows')])
    expect(claims(says(['Mono small-caps kickers'], { treatments: { ...BASE.treatments, eyebrowStyle: 'mono' } }))).toEqual([])
    expect(claims(says(['Monochrome imagery']), L1)).toEqual([]) // not an eyebrow claim (and axes are locked)
  })
  it('"dark sections" / ink bands need darkSections', () => {
    for (const m of ['Deep ink bands between light sections', 'Dark sections carry the numerals', 'Light → ink → light rhythm']) {
      expect(claims(says([m]))).toEqual([expect.stringContaining('dark (ink) sections')])
    }
    expect(claims(says(['Dark sections'], { treatments: { ...BASE.treatments, darkSections: true } }))).toEqual([])
    expect(claims(says(['Without dark sections']))).toEqual([])
  })
  it('reads the name, tagline and rationale too', () => {
    expect(claims({ ...BASE, rationale: 'The firm wants serif headlines. Calm.' })).toHaveLength(1)
    expect(claims({ ...BASE, tagline: 'Ink bands, warm clay' })).toHaveLength(1)
  })
})

describe('conceptConsistencyNotes — style axes', () => {
  it('flags an axis word whose axis is not set (at L3+)', () => {
    expect(claims(says(['A bordered nav with a hairline']))).toEqual([expect.stringContaining('style.nav is "default" — set style.nav to "bordered"')])
    expect(claims(says(['Inverted navbar in the primary colour']))).toEqual([expect.stringContaining('set style.nav to "inverted"')])
    expect(claims(says(['Flat tinted cards']))).toEqual([expect.stringContaining('style.cards')])
    expect(claims(says(['Monochrome photography']))).toEqual([expect.stringContaining('style.imageTreatment')])
    expect(claims(says(['Brand footer']))).toEqual([expect.stringContaining('style.footer')])
    expect(claims(says(['Underlined accent word']))).toEqual([expect.stringContaining('style.accentUsage')])
  })
  it('is satisfied by the matching axis (or the equivalent token)', () => {
    expect(claims(says(['A bordered nav'], { style: { nav: 'bordered' } }))).toEqual([])
    expect(claims(says(['Flat cards', 'Brand footer'], { style: { cards: 'flat', footer: 'brand' } }))).toEqual([])
    expect(claims(says(['Pill buttons'], { tokens: { ...BASE.tokens, roundness: 'pill' } }))).toEqual([])
    expect(claims(says(['Generous section rhythm'], { tokens: { ...BASE.tokens, density: 'airy' } }))).toEqual([])
  })
  it('reports each axis once', () => {
    expect(claims(says(['A bordered nav', 'Hairline navbar', 'Inverted nav']))).toHaveLength(1)
  })
  it('ignores axis words below L3 (the site’s style is held)', () => {
    expect(claims(says(['A bordered nav', 'Flat cards']), L2)).toEqual([])
  })
})

describe('conceptConsistencyNotes — signature CSS', () => {
  it('asks for 2–3 scoped css.blocks moves when fewer than 2 blocks carry CSS', () => {
    expect(conceptConsistencyNotes({ ...BASE, css: { global: '[data-block="hero"] h1 { color: red }', blocks: {} } }, L1)).toEqual([
      expect.stringMatching(new RegExp(`^${SIGNATURE_CSS_PREFIX} only 0 scoped css.blocks moves`)),
    ])
    expect(conceptConsistencyNotes({ ...BASE, css: { blocks: { hero: TWO_BLOCKS.blocks.hero, 'service-cards': '  ' } } }, L1)[0]).toContain('only 1 scoped css.blocks move ')
    expect(conceptConsistencyNotes(BASE, L1)).toEqual([])
  })
})

describe('claimClauses + SERIF_FONTS', () => {
  it('folds sans-serif and drops negated clauses', () => {
    expect(claimClauses(says(['Sans-serif body', 'no dark sections']))).toEqual(['harbor', 'calm authority', 'trustworthy and modern', 'sans body'])
  })
  it('every serif font is a curated font, and the serif/sans split covers the catalog', () => {
    for (const f of SERIF_FONTS) expect(CURATED_FONTS).toContain(f)
    const sans = CURATED_FONTS.filter((f) => !SERIF_FONTS.includes(f))
    expect(sans.every((f) => !/serif|caslon|playfair|merriweather|lora|bitter|fraunces/i.test(f) || /sans/i.test(f))).toBe(true)
  })
})
