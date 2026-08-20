import { describe, expect, it } from 'vitest'
import { collectPageImageRefs, computeImageCoverage, type ImageRefPage } from './image-coverage'

const HERO_QUERY = 'accountant reviewing financial reports at a desk'

const homePage: ImageRefPage = {
  page_url: '/',
  hero_image: 'home-hero.jpg',
  hero_image_query: HERO_QUERY,
  content_markdown: [
    '<!-- block: content-split | variant: image-right | image: home-split.jpg | alt: "team" | query: "professional team meeting modern office" -->',
    '## Our Approach',
    '',
    'Narrative prose.',
  ].join('\n'),
}

const servicesPage: ImageRefPage = {
  page_url: '/services',
  hero_image: 'services-hero.jpg',
  hero_image_query: 'tax planning paperwork',
  content_markdown: '## Services\n\nNo inline images here.',
}

// A page-header hero has no hero_image_query — it must NOT produce a ref.
const contactPage: ImageRefPage = {
  page_url: '/contact',
  hero_image: null,
  hero_image_query: null,
  content_markdown: null,
}

describe('collectPageImageRefs', () => {
  it('collects hero + inline refs across pages and skips query-less heroes', () => {
    const refs = collectPageImageRefs([homePage, servicesPage, contactPage])
    const filenames = refs.map(r => r.filename).sort()
    expect(filenames).toEqual(['home-hero.jpg', 'home-split.jpg', 'services-hero.jpg'])
  })

  it('tolerates null content_markdown without throwing', () => {
    expect(collectPageImageRefs([contactPage])).toEqual([])
  })

  it('marks hero refs with source "hero"', () => {
    const refs = collectPageImageRefs([servicesPage])
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ filename: 'services-hero.jpg', source: 'hero' })
  })
})

describe('computeImageCoverage', () => {
  it('reports zero missing when every referenced file is bundled', () => {
    const refs = collectPageImageRefs([homePage, servicesPage])
    const bundled = ['home-hero.jpg', 'home-split.jpg', 'services-hero.jpg', 'logo.svg']
    const cov = computeImageCoverage(refs, bundled)
    expect(cov).toEqual({ expected: 3, committed: 3, missing: [] })
  })

  it('lists exactly the referenced files that did not ship (the silent-failure signature)', () => {
    const refs = collectPageImageRefs([homePage, servicesPage])
    // Simulate resolution returning nothing — only the synthesized logo shipped.
    const cov = computeImageCoverage(refs, ['logo.svg'])
    expect(cov.expected).toBe(3)
    expect(cov.committed).toBe(0)
    expect(cov.missing.sort()).toEqual(['home-hero.jpg', 'home-split.jpg', 'services-hero.jpg'])
  })

  it('dedupes a filename referenced by more than one page', () => {
    const a: ImageRefPage = { page_url: '/a', hero_image: 'shared.jpg', hero_image_query: 'x', content_markdown: null }
    const b: ImageRefPage = { page_url: '/b', hero_image: 'shared.jpg', hero_image_query: 'y', content_markdown: null }
    const refs = collectPageImageRefs([a, b])
    expect(refs).toHaveLength(2)
    const cov = computeImageCoverage(refs, [])
    expect(cov.expected).toBe(1)
    expect(cov.missing).toEqual(['shared.jpg'])
  })

  it('accepts a Set of bundled filenames as well as an array', () => {
    const refs = collectPageImageRefs([servicesPage])
    const cov = computeImageCoverage(refs, new Set(['services-hero.jpg']))
    expect(cov.missing).toEqual([])
  })
})
