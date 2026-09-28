import { describe, it, expect } from 'vitest'
import { scopeGuardErrors, scopeGuardWarnings } from './scope-guard'

describe('scopeGuardErrors — fonts', () => {
  it('refuses a named font in any fragment', () => {
    const e = scopeGuardErrors('[data-block="hero"] h1 { font-family: "Playfair Display", serif; }', [])
    expect(e).toHaveLength(1)
    expect(e[0]).toMatch(/set_fonts/)
  })
  it('allows the font variables and inherit', () => {
    expect(scopeGuardErrors('[data-block="testimonials"] blockquote { font-family: var(--font-accent); }', [])).toEqual([])
    expect(scopeGuardErrors('[data-block="hero"] p { font-family: inherit; }', [])).toEqual([])
  })
})

describe('scopeGuardErrors — colours', () => {
  it.each([
    'color: #1a2b3c',
    'background: rgb(0 59 113)',
    'background-color: hsl(200 50% 40%)',
    'border: 1px solid navy',
    'border-top-color: oklch(60% 0.1 200)',
    'outline: 2px solid white',
    'background-image: linear-gradient(90deg, var(--color-primary), #ffffff)',
  ])('refuses a literal colour: %s', (decl) => {
    const e = scopeGuardErrors(`[data-block="cta-banner"] a { ${decl}; }`, [])
    expect(e).toHaveLength(1)
    expect(e[0]).toMatch(/--color-\*/)
  })
  it.each([
    'color: var(--color-action)',
    'background: color-mix(in srgb, var(--color-primary) 80%, black)',
    'background: var(--color-card, #fff)',
    'border: 1px solid var(--color-border)',
    'background: transparent',
    'color: currentColor',
    'box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15)',
    "background-image: url(\"data:image/svg+xml,%3Csvg fill='white'%3E%3C/svg%3E\")",
    'border-style: solid',
  ])('allows a token or neutral value: %s', (decl) => {
    expect(scopeGuardErrors(`[data-block="cta-banner"] a { ${decl}; }`, [])).toEqual([])
  })
  it('only counts declarations the edit introduces (delta vs the previous fragment)', () => {
    const previous = '[data-block="hero"] { background: #0b2545; }'
    expect(scopeGuardErrors('[data-block="hero"] { background: #0b2545; padding: 2rem; }', [previous])).toEqual([])
    expect(scopeGuardErrors('[data-block="hero"] { background: #0b2545; color: #ffffff; }', [previous])).toHaveLength(1)
  })
  it('lets through what an adopted concept fragment carries', () => {
    const concept = '[data-block="hero"] { color: #f4efe6; }'
    expect(scopeGuardErrors('[data-block="hero"] { color: #f4efe6; }', [null, concept])).toEqual([])
  })
  it('leaves unparseable CSS to the sanitizer', () => {
    expect(scopeGuardErrors('[data-block="hero"] { color: ', [])).toEqual([])
  })
})

describe('scopeGuardWarnings', () => {
  it('warns when one block fragment styles buttons', () => {
    const w = scopeGuardWarnings('[data-block="cta-banner"] [data-c5="button"] { border-radius: 0; }', 'cta-banner')
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/only change buttons inside "cta-banner"/)
    expect(scopeGuardWarnings('[data-component="navbar"] button { padding: 1rem; }', 'navbar')).toHaveLength(1)
  })
  it('is silent for non-button rules and for the global fragment', () => {
    expect(scopeGuardWarnings('[data-block="hero"] h1 { letter-spacing: -0.02em; }', 'hero')).toEqual([])
    expect(scopeGuardWarnings('[data-block="hero"] [data-c5="button"] { border-radius: 0; }', 'global')).toEqual([])
  })
})
