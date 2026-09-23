import { describe, it, expect } from 'vitest'
import { validateContentJobPatch, checkPhaseTransition, crossesIntoGeneration } from './_validate'

describe('checkPhaseTransition', () => {
  it('allows one step forward and any step back', () => {
    expect(checkPhaseTransition(4, 5)).toBeNull()
    expect(checkPhaseTransition(6, 2)).toBeNull()
  })
  it('refuses skipping phases (e.g. 2 → 5 past every gate)', () => {
    expect(checkPhaseTransition(2, 5)).toMatch(/Cannot jump/)
  })
  it('flags crossing into generation', () => {
    expect(crossesIntoGeneration(4, 5)).toBe(true)
    expect(crossesIntoGeneration(6, 5)).toBe(false)
  })
})

describe('validateContentJobPatch', () => {
  it('accepts well-formed payloads', () => {
    expect(
      validateContentJobPatch({
        palette: { primary: { hex: '#003B71', name: 'Primary' } },
        confirmed_sitemap: [{ url: '/', title: 'Home' }],
        nav_config: { primary: [{ label: 'Home', url: '/', children: [{ label: 'A', url: '/a' }] }] },
      })
    ).toBeNull()
  })
  it('rejects malformed shapes', () => {
    expect(validateContentJobPatch({ palette: 'red' })).toMatch(/palette/)
    expect(validateContentJobPatch({ palette: { primary: { hex: 'red' } } })).toMatch(/palette\.primary/)
    expect(validateContentJobPatch({ confirmed_sitemap: [{ url: 1 }] })).toMatch(/confirmed_sitemap/)
    expect(validateContentJobPatch({ nav_config: { primary: [{ label: 'x' }] } })).toMatch(/nav_config/)
    expect(validateContentJobPatch({ design_tokens: [] })).toMatch(/design_tokens/)
  })
})
