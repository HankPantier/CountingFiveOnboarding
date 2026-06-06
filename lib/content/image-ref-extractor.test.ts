import { describe, expect, it } from 'vitest'
import { extractInlineImageRefs } from './image-ref-extractor'

const PAGE = '/services/tax'

describe('extractInlineImageRefs', () => {
  it('extracts content-split refs (regression)', () => {
    const md = `<!-- block: content-split | variant: image-right | image: approach.jpg | query: "team meeting" -->\n## H`
    const refs = extractInlineImageRefs(md, PAGE)
    expect(refs).toEqual([
      { pageUrl: PAGE, filename: 'approach.jpg', subjectQuery: 'team meeting', source: 'content-split' },
    ])
  })

  it('extracts image-bg cta-banner refs; color-bg without image yields none', () => {
    const withImage = `<!-- block: cta-banner | variant: image-bg | image: banner.jpg | query: "office skyline" -->\n## H`
    const without = `<!-- block: cta-banner | variant: color-bg -->\n## H`
    expect(extractInlineImageRefs(withImage, PAGE)[0]).toMatchObject({
      filename: 'banner.jpg',
      source: 'cta-banner',
    })
    expect(extractInlineImageRefs(without, PAGE)).toHaveLength(0)
  })

  it('extracts with-image checklist refs; standalone without image yields none', () => {
    const withImage = `<!-- block: checklist-section | variant: with-image | image: who-we-serve.jpg | query: "small business owners" -->\n## H`
    const standalone = `<!-- block: checklist-section | variant: standalone -->\n## H`
    expect(extractInlineImageRefs(withImage, PAGE)[0]).toMatchObject({
      filename: 'who-we-serve.jpg',
      source: 'checklist-section',
    })
    expect(extractInlineImageRefs(standalone, PAGE)).toHaveLength(0)
  })

  it('falls back to filename slug when query is absent', () => {
    const md = `<!-- block: checklist-section | variant: with-image | image: year-end-planning.jpg -->\n## H`
    expect(extractInlineImageRefs(md, PAGE)[0].subjectQuery).toBe('year end planning')
  })

  it('tolerates an alt attribute between image and query', () => {
    const md = `<!-- block: content-split | variant: image-right | image: a.jpg | alt: "Accountant at a desk" | query: "office desk" -->\n## H`
    expect(extractInlineImageRefs(md, PAGE)[0]).toMatchObject({
      filename: 'a.jpg',
      subjectQuery: 'office desk',
      source: 'content-split',
    })
  })

  it('extracts content-cards photo refs (regression)', () => {
    const md = [
      `<!-- block: content-cards | variant: 3-col -->`,
      `## Resources`,
      ``,
      `### Year-End Guide`,
      `photo: year-end.jpg`,
      `query: tax planner reviewing documents`,
      ``,
      `Excerpt prose.`,
    ].join('\n')
    expect(extractInlineImageRefs(md, PAGE)[0]).toMatchObject({
      filename: 'year-end.jpg',
      subjectQuery: 'tax planner reviewing documents',
      source: 'content-cards',
    })
  })

  it('returns empty for markdown without refs', () => {
    expect(extractInlineImageRefs('## Just prose\n\nText.', PAGE)).toEqual([])
  })
})
