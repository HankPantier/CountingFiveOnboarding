import { describe, expect, it } from 'vitest'
import {
  normalizeBlogPath,
  resolveBlogConfig,
  serializeBlogConfig,
  DEFAULT_BLOG_PATH,
  DEFAULT_BLOG_CONFIG,
} from './blog-config'

describe('normalizeBlogPath', () => {
  it('defaults for absent/empty/non-string', () => {
    expect(normalizeBlogPath(undefined)).toBe(DEFAULT_BLOG_PATH)
    expect(normalizeBlogPath('')).toBe(DEFAULT_BLOG_PATH)
    expect(normalizeBlogPath(7)).toBe(DEFAULT_BLOG_PATH)
  })

  it('normalizes leading/trailing slashes', () => {
    expect(normalizeBlogPath('insights')).toBe('/insights')
    expect(normalizeBlogPath('/insights/')).toBe('/insights')
  })

  it('rejects multi-segment / unsafe paths', () => {
    expect(normalizeBlogPath('/a/b')).toBe(DEFAULT_BLOG_PATH)
    expect(normalizeBlogPath('../x')).toBe(DEFAULT_BLOG_PATH)
  })
})

describe('resolveBlogConfig', () => {
  it('produces Resources defaults from empty input', () => {
    expect(DEFAULT_BLOG_CONFIG).toEqual({
      path: '/resources',
      label: 'Resources',
      title: 'Resources',
      intro: 'Practical advice and seasonal updates from our team.',
    })
  })

  it('applies overrides and defaults title to label', () => {
    const cfg = resolveBlogConfig({ label: 'Insights', path: '/insights' })
    expect(cfg).toMatchObject({ label: 'Insights', path: '/insights', title: 'Insights' })
  })
})

describe('serializeBlogConfig', () => {
  it('round-trips through resolveBlogConfig', () => {
    const cfg = resolveBlogConfig({ label: 'News', path: '/news', title: 'Latest News', intro: 'Updates.' })
    expect(resolveBlogConfig(JSON.parse(serializeBlogConfig(cfg)))).toEqual(cfg)
  })
})
