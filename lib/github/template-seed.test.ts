import { describe, it, expect } from 'vitest'
import { isTemplateOnlyPath } from './template-seed'

describe('isTemplateOnlyPath', () => {
  it('excludes the template-default content marker', () => {
    expect(isTemplateOnlyPath('content/.template-default')).toBe(true)
  })

  it('keeps everything else, including look-alikes', () => {
    for (const p of [
      'package.json',
      'content/brand.json',
      'c5-template.json',
      'src/app/fonts.generated.ts',
      'content/.template-default.bak',
      'nested/content/.template-default',
    ]) {
      expect(isTemplateOnlyPath(p)).toBe(false)
    }
  })
})
