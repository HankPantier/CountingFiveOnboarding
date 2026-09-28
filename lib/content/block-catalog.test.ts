import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BLOCK_IDS, blockCatalogJson, blockLabel, blockSpec, blockVariantValues } from './block-catalog'

describe('block catalog mirror', () => {
  it('matches the template docs/design/blocks.json byte for byte', () => {
    expect(blockCatalogJson()).toBe(readFileSync(path.join(__dirname, '__fixtures__', 'blocks.template.json'), 'utf-8'))
  })
  it('covers the 24 registry blocks plus the 3 page openers', () => {
    expect(BLOCK_IDS).toHaveLength(27)
  })
})

describe('helpers', () => {
  it('look up specs without prototype leaks', () => {
    expect(blockSpec('content-split')?.default).toBe('image-right')
    expect(blockSpec('constructor')).toBeUndefined()
    expect(blockSpec('nope')).toBeUndefined()
  })
  it('list variant values and labels', () => {
    expect(blockVariantValues('hero')).toEqual(['statement', 'image', 'video', 'slider'])
    expect(blockVariantValues('form')).toContain('custom')
    expect(blockVariantValues('content-prose')).toEqual([])
    expect(blockVariantValues('nope')).toEqual([])
    expect(blockLabel('contact-info')).toBe('Contact details')
    expect(blockLabel('mystery')).toBe('mystery')
  })
})

describe('template versions', () => {
  it('compares numerically, segment by segment', async () => {
    const { compareTemplateVersions: cmp } = await import('./block-catalog')
    expect(cmp('2026.09.10', '2026.09.9')).toBe(1)
    expect(cmp('2026.09.9', '2026.09.10')).toBe(-1)
    expect(cmp('2026.09.8', '2026.09.8')).toBe(0)
    expect(cmp('2026.10.1', '2026.09.99')).toBe(1)
    expect(cmp('2027.01.1', '2026.12.40')).toBe(1)
    expect(cmp('2026.09', '2026.09.0')).toBe(0)
    expect(cmp('garbage', '2026.09.1')).toBe(-1)
    expect(cmp('2026.09.1', 'v2')).toBe(1)
    expect(cmp('x', 'y')).toBe(0)
  })
  it('filters variants by since and falls back to the baseline', async () => {
    const { blockVariantValuesAt, catalogEpoch, catalogVersion, BASELINE_SINCE } = await import('./block-catalog')
    expect(catalogVersion(null)).toBe(BASELINE_SINCE)
    expect(catalogVersion('nope')).toBe(BASELINE_SINCE)
    expect(catalogVersion('2026.09.8')).toBe('2026.09.8')
    expect(blockVariantValuesAt('checklist-section', '2026.09.8')).toEqual(blockVariantValues('checklist-section'))
    expect(blockVariantValuesAt('checklist-section', null)).toEqual(blockVariantValues('checklist-section'))
    // Below the baseline clamps to it (baseline values predate versioning).
    expect(catalogVersion('2026.08.1')).toBe(BASELINE_SINCE)
    expect(blockVariantValuesAt('checklist-section', '2026.08.1')).toEqual(blockVariantValues('checklist-section'))
    expect(catalogEpoch('2026.09.8')).toBe(BASELINE_SINCE)
    expect(catalogEpoch(null)).toBe(BASELINE_SINCE)
  })
})

describe('variantValuesAt', () => {
  it('hides a variant until the template version reaches its since', async () => {
    const { variantValuesAt } = await import('./block-catalog')
    const variants = [
      { value: 'grid', since: '2026.09.1' },
      { value: 'featured', since: '2026.09.9' },
      { value: 'wall', since: '2026.09.10' },
    ]
    expect(variantValuesAt(variants, '2026.09.8')).toEqual(['grid'])
    expect(variantValuesAt(variants, '2026.09.9')).toEqual(['grid', 'featured'])
    expect(variantValuesAt(variants, '2026.09.10')).toEqual(['grid', 'featured', 'wall'])
    expect(variantValuesAt(variants, null)).toEqual(['grid'])
  })
})

describe('template 2026.09.9 layout variants', () => {
  it('are flagged layout and appear only from 2026.09.9', async () => {
    const { blockVariantValuesAt, catalogEpoch, LAYOUTS_SINCE } = await import('./block-catalog')
    expect(LAYOUTS_SINCE).toBe('2026.09.9')
    expect(blockSpec('service-cards')?.variants.find((x) => x.value === 'list')).toEqual({ value: 'list', since: '2026.09.9', layout: true })
    expect(blockVariantValuesAt('service-cards', '2026.09.8')).toEqual(['2-col', '3-col'])
    expect(blockVariantValuesAt('service-cards', '2026.09.9')).toEqual(['2-col', '3-col', 'list'])
    expect(blockVariantValuesAt('cta-banner', '2026.09.9')).toEqual(['color-bg', 'image-bg', 'color-bg-centered', 'image-bg-centered'])
    expect(blockVariantValuesAt('testimonials', null)).toEqual(['carousel', 'grid'])
    expect(catalogEpoch('2026.09.8')).toBe('2026.09.1')
    expect(catalogEpoch('2026.09.9')).toBe('2026.09.9')
  })
})
