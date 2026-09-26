import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { themeDeployEntries } from './theme-deploy-entries'
import { generateThemeCss } from './theme-css-generator'
import { fontsModuleKind, generateFontsModule } from './font-module-generator'
import { normalizeTypography } from '@/app/api/edit/[id]/theme/_theme'
import { FONTS_MODULE_PATH } from '@/lib/design/drift'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'

const FIX = path.join(__dirname, '__fixtures__')
const brandJson = JSON.parse(readFileSync(path.join(FIX, 'brand.golden.json'), 'utf-8')) as BrandJson
const designJson = JSON.parse(readFileSync(path.join(FIX, 'design.golden.json'), 'utf-8')) as DesignJson
const golden = readFileSync(path.join(FIX, 'theme.css.golden'), 'utf-8')

const T1_MARKER = JSON.stringify({ templateVersion: '2026.09.1', capabilities: ['fonts'] })

describe('themeDeployEntries', () => {
  it('ships only theme.css when the draft has no template marker (pre-T1)', () => {
    const out = themeDeployEntries({ brandJson, designJson, markerText: null })
    expect(out.map((e) => e.path)).toEqual(['src/styles/theme.css'])
    expect(out[0].content).toBe(golden)
  })

  it('ships only theme.css when the marker does not declare fonts (or is malformed)', () => {
    for (const markerText of ['{"templateVersion":"x","capabilities":[]}', 'not json', '[]']) {
      expect(themeDeployEntries({ brandJson, designJson, markerText }).map((e) => e.path)).toEqual(['src/styles/theme.css'])
    }
  })

  it('adds the SYNCED fonts module on T1+ templates, byte-identical to the Controls route output', () => {
    const out = themeDeployEntries({ brandJson, designJson, markerText: T1_MARKER })
    expect(out.map((e) => e.path)).toEqual(['src/styles/theme.css', FONTS_MODULE_PATH])
    expect(out[0].content).toBe(generateThemeCss(brandJson, designJson))
    const fonts = out[1].content
    expect(fonts).toBe(generateFontsModule(normalizeTypography(designJson.typography)).source)
    expect(fontsModuleKind(fonts)).toBe('synced')
  })

  it('normalizes a design.json missing typography fields (never throws, still SYNCED)', () => {
    const partial = { ...designJson, typography: { headingFont: 'Inter' } } as unknown as DesignJson
    const out = themeDeployEntries({ brandJson, designJson: partial, markerText: T1_MARKER })
    expect(out[1].content).toBe(generateFontsModule(normalizeTypography(partial.typography)).source)
  })

  it('returns a fresh array each call (callers may concatenate without aliasing)', () => {
    const a = themeDeployEntries({ brandJson, designJson, markerText: T1_MARKER })
    const b = themeDeployEntries({ brandJson, designJson, markerText: T1_MARKER })
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})
