import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { generateThemeCss } from '@/lib/content/theme-css-generator'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import { classifyThemeCss, tokenMap } from './theme-drift'

const FIX = path.join(process.cwd(), 'lib', 'content', '__fixtures__')
const brandText = readFileSync(path.join(FIX, 'brand.golden.json'), 'utf-8')
const designText = readFileSync(path.join(FIX, 'design.golden.json'), 'utf-8')
const generated = generateThemeCss(JSON.parse(brandText) as BrandJson, JSON.parse(designText) as DesignJson)

describe('classifyThemeCss', () => {
  it('in-sync for the generator output itself', () => {
    expect(classifyThemeCss(generated, brandText, designText).state).toBe('in-sync')
  })

  it('additive when only generator-added tokens (e.g. --color-ink) are missing — the bblcpa/Abramson/Accord case', () => {
    const withoutInk = generated.replace(/^\s*--color-ink(-foreground)?:[^\n]*\n/gm, '')
    expect(withoutInk).not.toBe(generated)
    const r = classifyThemeCss(withoutInk, brandText, designText)
    expect(r.state).toBe('additive')
    expect(r.paletteDiffs).toEqual([])
    expect(r.missing.some((k) => k.endsWith('--color-ink'))).toBe(true)
  })

  it('palette when a core token differs — the house-cyan-vs-brand case', () => {
    const cur = tokenMap(generated).get('light:--color-action')!
    const cyan = generated.replace(new RegExp(cur, 'gi'), '#123456')
    const r = classifyThemeCss(cyan, brandText, designText)
    expect(r.state).toBe('palette')
    expect(r.committedAction).toBe('#123456')
    expect(r.paletteDiffs).toContain('light:--color-action')
  })

  it('other for comment/format-only differences; missing / unknown', () => {
    expect(classifyThemeCss(`/* hand note */\n${generated}`, brandText, designText).state).toBe('other')
    expect(classifyThemeCss(null, brandText, designText).state).toBe('missing')
    expect(classifyThemeCss(generated, null, designText).state).toBe('unknown')
    expect(classifyThemeCss(generated, '{bad', designText).state).toBe('unknown')
  })
})
