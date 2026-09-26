import { describe, it, expect } from 'vitest'
import { VALID } from './__fixtures__/valid-bundle'
import { applyChatEdit, describeChatEdit, fragmentOf, sameLevers } from './chat-edits'

describe('applyChatEdit', () => {
  it('merges palette / fonts / treatments patches, ignoring undefined keys', () => {
    const b = applyChatEdit(VALID, { kind: 'palette', patch: { action: '#0a7c86', primary: undefined } })
    expect(b.palette).toEqual({ ...VALID.palette, action: '#0a7c86' })
    expect(applyChatEdit(VALID, { kind: 'treatments', patch: { darkSections: false } }).treatments.darkSections).toBe(false)
    expect(applyChatEdit(VALID, { kind: 'fonts', patch: { accentFont: 'Public Sans' } }).typography.accentFont).toBe('Public Sans')
  })
  it('merges style-axis patches, canonicalizing away default values', () => {
    const styled = applyChatEdit(VALID, { kind: 'style', patch: { cards: 'flat' } })
    expect(styled.style).toEqual({ cards: 'flat' })
    expect(applyChatEdit(styled, { kind: 'style', patch: { cards: 'default' } }).style).toBeUndefined()
  })
  it('merges partial spacing / radius maps', () => {
    const b = applyChatEdit(VALID, { kind: 'tokens', patch: { density: 'airy', radius: { lg: '24px' }, spacing: { xl: '64px' } } })
    expect(b.tokens).toMatchObject({ density: 'airy', radius: { ...VALID.tokens.radius, lg: '24px' }, spacing: { ...VALID.tokens.spacing, xl: '64px' } })
  })
  it('sets, replaces and removes CSS fragments (blank = remove)', () => {
    const set = applyChatEdit(VALID, { kind: 'css', target: 'service-cards', css: '[data-block="service-cards"] { gap: 2rem; }' })
    expect(fragmentOf(set.css, 'service-cards')).toContain('gap: 2rem')
    expect(fragmentOf(set.css, 'hero')).toBe(VALID.css.blocks.hero)
    expect(fragmentOf(applyChatEdit(set, { kind: 'remove-css', target: 'service-cards' }).css, 'service-cards')).toBeNull()
    const g = applyChatEdit(VALID, { kind: 'css', target: 'global', css: ':root { --c5-space-md: 20px; }' })
    expect(fragmentOf(g.css, 'global')).toContain('--c5-space-md')
    expect(fragmentOf(applyChatEdit(g, { kind: 'css', target: 'global', css: '  ' }).css, 'global')).toBeNull()
  })
  it('never mutates its input', () => {
    const before = JSON.stringify(VALID)
    applyChatEdit(VALID, { kind: 'remove-css', target: 'hero' })
    expect(JSON.stringify(VALID)).toBe(before)
  })
})

describe('sameLevers / describeChatEdit', () => {
  it('ignores identity + meta, sees every lever', () => {
    expect(sameLevers(VALID, { ...VALID, name: 'Other', meta: { source: 'chat' } })).toBe(true)
    expect(sameLevers(VALID, applyChatEdit(VALID, { kind: 'palette', patch: { action: '#0a7c86' } }))).toBe(false)
  })
  it('names what an edit touches', () => {
    expect(describeChatEdit({ kind: 'palette', patch: { action: '#0a7c86', nearWhite: '#ffffff' } })).toBe('palette (action, nearWhite)')
    expect(describeChatEdit({ kind: 'style', patch: { cards: 'flat', nav: 'bordered' } })).toBe('style (cards, nav)')
    expect(describeChatEdit({ kind: 'css', target: 'service-cards', css: 'x' })).toBe('service-cards CSS')
    expect(describeChatEdit({ kind: 'remove-css', target: 'global' })).toBe('removed global CSS')
  })
})
