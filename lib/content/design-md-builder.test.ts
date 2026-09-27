import { describe, it, expect } from 'vitest'
import { buildDesignMd, buildDesignMdFromTheme, isGeneratedDesignMd } from './design-md-builder'
import type { PaletteData } from '@/types/palette'
import type { DesignTokens } from '@/types/design-tokens'
import type { SessionSchema } from '@/types/session-schema'

const sw = (hex: string, name: string) => ({ hex, name })
const PALETTE: PaletteData = {
  primary: sw('#003b71', 'Harbor Navy'),
  secondary: sw('#eef3f8', 'Mist'),
  complementary: sw('#c9a227', 'Brass'),
  action: sw('#e4572e', 'Signal'),
  nearBlack: sw('#1a1a1a', 'Ink'),
  nearWhite: sw('#fbfaf7', 'Paper'),
}
// bblcpa's shape (R2 F3): an editorial feel on a sans pairing (Nunito).
const TOKENS: DesignTokens = {
  typePairing: { id: 'friendly-rounded', headingFont: 'Nunito', bodyFont: 'Nunito', label: 'Friendly' },
  roundness: 'sharp',
  density: 'balanced',
  visualFeel: 'editorial',
}
const input = (tokens: DesignTokens = TOKENS) => ({ firmName: 'BBL CPA', palette: PALETTE, tokens, brand: undefined, business: undefined, location: null })

describe('buildDesignMd — headline wording (R2 F3)', () => {
  it('an editorial feel never claims serif headlines for a sans heading font', () => {
    const md = buildDesignMd(input())
    expect(md).toContain('Nunito for headlines')
    expect(md).not.toMatch(/serif headlines/i)
  })
  it('the serif headline treatment is stated from headlineStyle', () => {
    const md = buildDesignMd(input({ ...TOKENS, headlineStyle: 'serif', typePairing: { ...TOKENS.typePairing, accentFont: 'Fraunces' } }))
    expect(md).toContain('Headlines use the serif display treatment.')
    expect(md).toContain('Fraunces as the accent face')
    expect(md).toContain('Keep the serif headline treatment consistent across pages')
  })
})

describe('isGeneratedDesignMd', () => {
  it('recognises the builder output (package and Studio variants)', () => {
    expect(isGeneratedDesignMd(buildDesignMd(input()))).toBe(true)
    expect(isGeneratedDesignMd(buildDesignMd({ ...input(), direction: { name: 'Harbor Light', tagline: 't', moves: ['m'] } }))).toBe(true)
    expect(isGeneratedDesignMd(buildDesignMd(input()).replace(/\n/g, '\r\n'))).toBe(true)
  })
  it('refuses a hand-written or hand-reshaped file', () => {
    expect(isGeneratedDesignMd('# Our design\n\nWarm, editorial, serif.\n')).toBe(false)
    const edited = buildDesignMd(input()).replace('Use navy-tinted shadows, not pure black.', 'Shadows are soft and warm.')
    expect(isGeneratedDesignMd(edited)).toBe(false)
    const reordered = buildDesignMd(input()).replace('## Overview', '## Intro')
    expect(isGeneratedDesignMd(reordered)).toBe(false)
  })
})

describe('buildDesignMdFromTheme', () => {
  const brand = { firm: { name: 'BBL CPA' }, palette: { primary: '#123a5c', secondary: '#eef3f8', complementary: '#c9a227', action: '#e4572e', nearBlack: '#1a1a1a', nearWhite: '#fbfaf7' } }
  const design = {
    typography: { headingFont: 'Fraunces', bodyFont: 'Public Sans', accentFont: 'Fraunces', googleFontsUrl: 'https://fonts.googleapis.com/css2?family=X' },
    roundness: 'soft' as const,
    density: 'airy' as const,
    visualFeel: 'editorial' as const,
    headlineStyle: 'serif' as const,
  }
  it('writes the applied theme, the Studio direction, and stays recognisable as generated', () => {
    const md = buildDesignMdFromTheme({ brand, design, schema: { brand: { toneAdjectives: ['warm'] } } as unknown as SessionSchema, direction: { name: 'Port Arthur Ledger', tagline: 'Harbor calm', moves: ['Brass rule under kickers'] } })
    expect(md.startsWith('<!-- Fonts: https://fonts.googleapis.com/css2?family=X -->')).toBe(true)
    expect(md).toContain('primary: "#123a5c"')
    expect(md).toContain('**primary #123a5c** as the structural primary')
    expect(md).toContain('Fraunces for headlines, Public Sans for body copy')
    expect(md).toContain('## Design direction')
    expect(md).toContain('**Port Arthur Ledger** — Harbor calm')
    expect(md).toContain('- Brass rule under kickers')
    expect(md).toContain('**Tone:** warm.')
    expect(isGeneratedDesignMd(md)).toBe(true)
  })
  it('omits the direction section when none is given (a restore)', () => {
    expect(buildDesignMdFromTheme({ brand, design, schema: null })).not.toContain('## Design direction')
  })
})
