import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  STYLE_AXIS_ATTRIBUTES,
  StyleAxesInputSchema,
  canonicalStyle,
  normalizeStyleAxes,
  styleAxesJson,
  styleAxisHtmlAttributes,
} from './style-axes'

describe('style axes mirror', () => {
  it('matches the template docs/design/style-axes.json byte for byte', () => {
    expect(styleAxesJson()).toBe(readFileSync(path.join(__dirname, '__fixtures__', 'style-axes.template.json'), 'utf-8'))
  })
  it('lists the 8 html attributes', () => {
    expect(STYLE_AXIS_ATTRIBUTES).toHaveLength(8)
    expect(STYLE_AXIS_ATTRIBUTES).toContain('data-c5-cards')
  })
})

describe('canonical style', () => {
  it('drops defaults and becomes undefined when empty', () => {
    expect(canonicalStyle({ cards: 'default', nav: 'default' })).toBeUndefined()
    expect(canonicalStyle({ cards: 'flat', nav: 'default' })).toEqual({ cards: 'flat' })
    expect(canonicalStyle(undefined)).toBeUndefined()
  })
  it('normalizes hand-edited design.json values', () => {
    expect(normalizeStyleAxes({ cards: 'flat', buttons: 'wobbly', glitter: 'x' })).toEqual({ cards: 'flat' })
    expect(normalizeStyleAxes('nope')).toBeUndefined()
  })
  it('the input schema rejects unknown values', () => {
    expect(StyleAxesInputSchema.safeParse({ cards: 'wobbly' }).success).toBe(false)
    expect(StyleAxesInputSchema.safeParse({ cards: 'default', nav: 'inverted' }).success).toBe(true)
  })
})

describe('styleAxisHtmlAttributes', () => {
  it('sets non-default axes and REMOVES the rest (preview composition)', () => {
    const attrs = styleAxisHtmlAttributes({ cards: 'flat' })
    expect(attrs['data-c5-cards']).toBe('flat')
    expect(attrs['data-c5-nav']).toBeNull()
    expect(Object.keys(attrs)).toHaveLength(8)
  })
})
