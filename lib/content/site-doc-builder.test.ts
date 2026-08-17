import { describe, it, expect } from 'vitest'
import { buildSiteDocx, type SiteDocPage } from './site-doc-builder'
import { stripInlineMarks } from './markdown-to-docx'
import { formatAddress } from '@/app/api/edit/[id]/document/route'

function page(overrides: Partial<SiteDocPage> = {}): SiteDocPage {
  return {
    path: 'content/pages/home.md',
    url: '/',
    title: 'Home',
    isPost: false,
    body: '## Welcome\n\nSome body copy.',
    heroEyebrow: '',
    heroHeadline: '',
    heroSubhead: '',
    metaTitle: '',
    metaDescription: '',
    targetKeyword: '',
    canonicalUrl: '',
    schemaMarkup: '',
    secondaryKeywords: [],
    answerBlock: '',
    eeatSignals: [],
    internalLinks: [],
    faqBlock: [],
    ...overrides,
  }
}

describe('buildSiteDocx', () => {
  it('produces a non-empty .docx buffer for a page with hero, SEO, and contact', async () => {
    const buffer = await buildSiteDocx({
      firmName: 'Acme CPA',
      websiteUrl: 'https://acme.example',
      pages: [
        page({
          heroEyebrow: 'Since 1972',
          heroHeadline: 'CPAs who actually *answer*.',
          heroSubhead: 'Boutique tax and advisory.',
          metaTitle: 'Acme CPA — Home',
          metaDescription: 'Boutique CPA firm.',
        }),
      ],
      nav: null,
      contact: { phone: '(978) 555-0100', email: 'hi@acme.example', address: '12 Main St, Tyngsborough, MA 01879' },
      generatedOn: 'August 17, 2026',
    })
    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(buffer.length).toBeGreaterThan(0)
    // docx (a zip) starts with the PK local-file-header magic bytes.
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('does not throw when hero, SEO, and contact are all absent', async () => {
    const buffer = await buildSiteDocx({
      firmName: 'Acme CPA',
      websiteUrl: '',
      pages: [page()],
      nav: null,
      generatedOn: 'August 17, 2026',
    })
    expect(buffer.length).toBeGreaterThan(0)
  })
})

describe('stripInlineMarks', () => {
  it('removes bold, italic, and link markdown while keeping text', () => {
    expect(stripInlineMarks('CPAs who **actually** *answer*.')).toBe('CPAs who actually answer.')
    expect(stripInlineMarks('See [our services](/services) now')).toBe('See our services now')
  })
})

describe('formatAddress', () => {
  it('joins non-empty parts into one line', () => {
    expect(
      formatAddress({
        name: 'HQ', street: '12 Main St', line2: 'Suite 3', city: 'Tyngsborough',
        state: 'MA', zip: '01879', phone: '', fax: '', email: '', hours: {},
      }),
    ).toBe('12 Main St, Suite 3, Tyngsborough, MA 01879')
  })

  it('skips missing street/line2 and empty state/zip', () => {
    expect(
      formatAddress({
        name: 'HQ', street: '', line2: '', city: 'Boston',
        state: 'MA', zip: '', phone: '', fax: '', email: '', hours: {},
      }),
    ).toBe('Boston, MA')
  })

  it('returns empty string for an undefined location', () => {
    expect(formatAddress(undefined)).toBe('')
  })
})
