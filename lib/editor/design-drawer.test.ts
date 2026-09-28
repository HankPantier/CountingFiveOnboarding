import { describe, it, expect } from 'vitest'
import { designPreviewRoute } from './design-drawer'

describe('designPreviewRoute', () => {
  it('maps page files to their site route', () => {
    expect(designPreviewRoute('content/pages/home.md')).toBe('/')
    expect(designPreviewRoute('content/pages/services--tax.md')).toBe('/services/tax')
  })

  it('falls back to the homepage for anything that is not a page', () => {
    expect(designPreviewRoute(null)).toBe('/')
    expect(designPreviewRoute('content/nav.json')).toBe('/')
    expect(designPreviewRoute('content/resources/some-post.md')).toBe('/')
    expect(designPreviewRoute('__theme__')).toBe('/')
  })
})
