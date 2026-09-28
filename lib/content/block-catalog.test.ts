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
