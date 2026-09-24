import { describe, it, expect } from 'vitest'
import { parseDesignBundle } from './bundle'
import { VALID } from './__fixtures__/valid-bundle'

describe('parseDesignBundle', () => {
  it('accepts a valid bundle and lowercases hex colours', () => {
    const r = parseDesignBundle({ ...VALID, palette: { ...VALID.palette, primary: '#003B71' } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.bundle.palette.primary).toBe('#003b71')
  })

  it('fills optional narrative fields with defaults', () => {
    const { tagline: _t, rationale: _r, moves: _m, ...rest } = VALID
    const r = parseDesignBundle(rest)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.bundle.moves).toEqual([])
  })

  it.each([
    ['bad hex', { palette: { ...VALID.palette, action: 'teal' } }, 'palette.action'],
    ['uncurated font', { typography: { ...VALID.typography, headingFont: 'Comic Sans MS' } }, 'typography.headingFont'],
    ['bad length', { tokens: { ...VALID.tokens, spacing: { ...VALID.tokens.spacing, md: '16 px; color:red' } } }, 'tokens.spacing.md'],
    ['bad enum', { tokens: { ...VALID.tokens, roundness: 'round' } }, 'tokens.roundness'],
    ['unknown css target', { css: { blocks: { sidebar: 'x' } } }, 'css.blocks'],
    ['wrong schemaVersion', { schemaVersion: 2 }, 'schemaVersion'],
  ])('rejects %s', (_n, patch, path) => {
    const r = parseDesignBundle({ ...VALID, ...patch })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain(path)
  })
})
