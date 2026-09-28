import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LayoutPresetsInputSchema } from './layout-presets-schema'
import {
  LAYOUT_PRESETS,
  LAYOUT_PRESET_ATTRIBUTES,
  LAYOUT_PRESET_NAMES,
  canonicalLayout,
  describeLayout,
  layoutPresetHtmlAttributes,
  layoutPresetsJson,
  normalizeLayoutPresets,
  presetForBlock,
  sameLayout,
} from './layout-presets'

describe('layout presets mirror', () => {
  it('matches the template docs/design/layout-presets.json byte for byte', () => {
    expect(layoutPresetsJson()).toBe(
      readFileSync(path.join(__dirname, '__fixtures__', 'layout-presets.template.json'), 'utf-8')
    )
  })
  it('lists the 5 html attributes', () => {
    expect(LAYOUT_PRESET_ATTRIBUTES).toHaveLength(5)
    expect(LAYOUT_PRESET_ATTRIBUTES).toContain('data-c5-layout-cta-banner')
  })
  it('the zod schema covers exactly the mirrored presets', () => {
    expect(Object.keys(LayoutPresetsInputSchema.shape).sort()).toEqual([...LAYOUT_PRESET_NAMES].sort())
    for (const name of LAYOUT_PRESET_NAMES) {
      for (const v of LAYOUT_PRESETS[name].values) {
        expect(LayoutPresetsInputSchema.safeParse({ [name]: v }).success).toBe(true)
      }
    }
  })
})

describe('canonical layout', () => {
  it('drops defaults and becomes undefined when empty', () => {
    expect(canonicalLayout({ cards: 'default', faq: 'default' })).toBeUndefined()
    expect(canonicalLayout({ cards: 'list', faq: 'default' })).toEqual({ cards: 'list' })
    expect(canonicalLayout(undefined)).toBeUndefined()
  })
  it('normalizes hand-edited design.json values', () => {
    expect(normalizeLayoutPresets({ cards: 'list', faq: 'wobbly', glitter: 'x' })).toEqual({ cards: 'list' })
    expect(normalizeLayoutPresets('nope')).toBeUndefined()
    expect(normalizeLayoutPresets(['list'])).toBeUndefined()
  })
  it('the input schema rejects unknown values and keys', () => {
    expect(LayoutPresetsInputSchema.safeParse({ cards: 'grid' }).success).toBe(false)
    expect(LayoutPresetsInputSchema.safeParse({ hero: 'split' }).success).toBe(false)
    expect(LayoutPresetsInputSchema.safeParse({ cards: 'default', team: 'list' }).success).toBe(true)
  })
  it('sameLayout ignores defaults and key order', () => {
    expect(sameLayout(undefined, { cards: 'default' })).toBe(true)
    expect(sameLayout({ faq: 'split', cards: 'list' }, { cards: 'list', faq: 'split' })).toBe(true)
    expect(sameLayout({ cards: 'list' }, undefined)).toBe(false)
  })
})

describe('layoutPresetHtmlAttributes', () => {
  it('sets non-default presets and REMOVES the rest (preview composition)', () => {
    const attrs = layoutPresetHtmlAttributes({ faq: 'split' })
    expect(attrs['data-c5-layout-faq']).toBe('split')
    expect(attrs['data-c5-layout-cards']).toBeNull()
    expect(Object.keys(attrs)).toHaveLength(5)
  })
})

describe('presetForBlock / describeLayout', () => {
  it('finds the preset family of a block', () => {
    expect(presetForBlock({ cards: 'list' }, 'feature-grid')).toEqual({ name: 'cards', value: 'list' })
    expect(presetForBlock({ cards: 'list' }, 'faq-accordion')).toBeNull()
    expect(presetForBlock(undefined, 'feature-grid')).toBeNull()
  })
  it('describes a layout compactly', () => {
    expect(describeLayout(undefined)).toBe('all default')
    expect(describeLayout({ faq: 'split', cards: 'list' })).toBe('cards=list, faq=split')
  })
})
