import { describe, expect, it } from 'vitest'
import {
  collectRehostTargets,
  missingLinksSection,
  pagePathResolver,
  rewriteVerbatimLinks,
  wrapVerbatimSections,
} from './verbatim-page-generator'
import { templateSectionPattern } from '@/lib/editor/block-annotation'
import type { SessionSchema } from '@/types/session-schema'

const ORIGIN = 'https://www.acme-cpa.com'

const SNAPSHOT = `# Forms, Documents & Links

Use the links below to download what you need.

## Tax organizers

- [2025 Individual Organizer](https://acme-cpa.com/wp-content/uploads/organizer-2025.pdf)
- [IRS Form W-9](https://www.irs.gov/pub/irs-pdf/fw9.pdf)

## Helpful links

- [Pay your invoice](https://acme.cpacharge.com/pay)
- [Contact us](/contact)
- [Our old history page](https://www.acme-cpa.com/our-history/#founders)
- [Retired page](/promo-2019)

![Office photo](/wp-content/uploads/office.jpg "Our office")
`

describe('wrapVerbatimSections', () => {
  it('produces only sections the template renders, wording unchanged', () => {
    const out = wrapVerbatimSections(SNAPSHOT, 'Forms, Documents & Links')
    const sections = [...out.matchAll(templateSectionPattern())]
    expect(sections.map((m) => [m[1], m[7]])).toEqual([
      ['content-prose', 'Forms, Documents & Links'],
      ['content-prose', 'Tax organizers'],
      ['content-prose', 'Helpful links'],
    ])
    expect(out).not.toMatch(/^# /m)
    expect(out).toContain('Use the links below to download what you need.')
    // Every non-annotation line survives verbatim.
    const rendered = sections.map((m) => m[8]).join('\n')
    for (const line of SNAPSHOT.split('\n').filter((l) => l.trim() && !l.startsWith('#'))) {
      expect(rendered).toContain(line)
    }
  })

  it('handles a page with no headings at all', () => {
    const out = wrapVerbatimSections('Just one paragraph.', 'Disclaimer')
    expect([...out.matchAll(templateSectionPattern())].map((m) => m[7])).toEqual(['Disclaimer'])
  })
})

describe('collectRehostTargets', () => {
  it('takes every image and only old-site documents', () => {
    const t = collectRehostTargets(SNAPSHOT, ORIGIN)
    expect(t.images).toEqual(['https://www.acme-cpa.com/wp-content/uploads/office.jpg'])
    expect(t.documents).toEqual(['https://acme-cpa.com/wp-content/uploads/organizer-2025.pdf'])
  })
})

describe('rewriteVerbatimLinks', () => {
  const schema: SessionSchema = {
    current_sitemap: [
      { url: '/our-history', title: 'History', action: 'consolidate', new_url: '/about', live: true },
      { url: '/promo-2019', title: 'Promo', action: 'redirect', new_url: '/', live: true },
    ],
  }
  const resolve = pagePathResolver(schema, ['/', '/about', '/contact', '/forms-documents-links'])

  it('re-points assets, remaps old pages, keeps external links', () => {
    const rehosted = new Map([
      ['https://acme-cpa.com/wp-content/uploads/organizer-2025.pdf', '/content-assets/forms-organizer-2025-ab12cd34.pdf'],
      ['https://www.acme-cpa.com/wp-content/uploads/office.jpg', '/content-assets/forms-office-ef56ab78.jpg'],
    ])
    const out = rewriteVerbatimLinks(SNAPSHOT, ORIGIN, rehosted, resolve)
    expect(out).toContain('[2025 Individual Organizer](/content-assets/forms-organizer-2025-ab12cd34.pdf)')
    expect(out).toContain('[IRS Form W-9](https://www.irs.gov/pub/irs-pdf/fw9.pdf)')
    expect(out).toContain('[Pay your invoice](https://acme.cpacharge.com/pay)')
    expect(out).toContain('[Contact us](/contact)')
    expect(out).toContain('[Our old history page](/about#founders)')
    expect(out).toContain('[Retired page](/)')
    expect(out).toContain('![Office photo](/content-assets/forms-office-ef56ab78.jpg "Our office")')
  })

  it('drops images it could not re-host and unlinks dead pages, keeping anchors', () => {
    const out = rewriteVerbatimLinks(
      'See [old page](/gone) and ![x](https://cdn.example.com/a.png). Get [the PDF](/files/a.pdf).',
      ORIGIN,
      new Map(),
      () => null,
    )
    expect(out).toBe('See old page and . Get [the PDF](/files/a.pdf).')
  })
})

describe('missingLinksSection', () => {
  it('lists only links the written page dropped, as a renderable section', () => {
    const written = '<!-- block: content-prose -->\n## Pay\n\n[Pay online](https://acme.cpacharge.com/pay) anytime.'
    const source = '- [Pay your invoice](https://acme.cpacharge.com/pay)\n- [W-9](https://www.irs.gov/pub/irs-pdf/fw9.pdf)\n- [Organizer](/content-assets/forms-organizer-ab12cd34.pdf)\n- [W-9 again](https://www.irs.gov/pub/irs-pdf/fw9.pdf)'
    const section = missingLinksSection(written, source)
    expect([...section.matchAll(templateSectionPattern())].map((m) => m[7])).toEqual(['Links and resources'])
    expect(section).toContain('- [W-9](https://www.irs.gov/pub/irs-pdf/fw9.pdf)')
    expect(section).toContain('- [Organizer](/content-assets/forms-organizer-ab12cd34.pdf)')
    expect(section).not.toContain('cpacharge')
    expect(section.match(/fw9/g)).toHaveLength(1)
  })
  it('is empty when nothing is missing', () => {
    expect(missingLinksSection('[a](https://x.com)', '[b](https://x.com)')).toBe('')
  })
})
