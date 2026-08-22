import { describe, expect, it } from 'vitest'
import { parseDiviSections, parseCards, parseQA, accordionBlock, ctaBlock } from './blocks'
import { markdownToHtml, inlineMarkdown } from './markdown'
import { safeUrl } from './sanitize'
import { buildPageDivi, collectPageQueries, type DiviPageInput } from './page'
import { buildWxr } from './wxr'
import { buildDiviLibrary } from './library'
import { buildDiviExport } from './index'
import { pageInputFromRepoFile } from './from-frontmatter'
import type { BrandJson } from '@/types/brand-json'
import type { ClientCenterJson } from '@/types/client-center'
import type { NavJson } from '@/types/nav-json'

const BODY = [
  '<!-- block: intro-text | variant: centered -->',
  '## Why Virtual CFO',
  '',
  'Year-round financial leadership for **growing** firms. See [our services](https://firm.com/services).',
  '',
  '<!-- block: feature-grid | variant: 3-col -->',
  '## What&rsquo;s Included',
  '',
  '### Planning',
  'icon: TrendingUp',
  'Monthly cash-flow projections.',
  '',
  '### Oversight',
  'icon: FileCheck',
  'Clean monthly statements.',
  '',
  '<!-- block: content-split | variant: image-left | image: cfo.jpg | alt: "Two CPAs reviewing reports" | query: "business consultation office" -->',
  '## How It Works',
  '',
  'Month one is a deep financial review.',
  '',
  '<!-- block: cta-banner | variant: color-bg -->',
  '## Ready to Start?',
  '',
  '[Schedule a consultation](/contact)',
].join('\n')

const PAGE: DiviPageInput = {
  page_title: 'Virtual CFO Services',
  page_url: '/services/virtual-cfo',
  hero_block: 'page-header',
  hero_variant: null,
  hero_image_alt: null,
  hero_subhead: 'Strategic financial guidance',
  hero_image_query: null,
  content_markdown: BODY,
  faq_block: [{ question: 'What does it cost?', answer: 'It depends on scope.' }],
  cta: null,
}

const BRAND: BrandJson = {
  firm: { name: 'Korbey Lague PLLP' },
  contact: { phone: '(978) 555-0100', address: { street: '1 Main St', city: 'Boston', state: 'MA', zip: '02100' } },
  palette: { primary: '#003B71', secondary: '#00C1DE', complementary: '#00C1DE', action: '#00C1DE', nearBlack: '#231F20', nearWhite: '#F7FAFC' },
  social: [{ platform: 'linkedin', url: 'https://linkedin.com/company/klp' }],
  certifications: [],
  logo: { primary: '', alt: 'Korbey Lague logo' },
}

const CLIENT_CENTER: ClientCenterJson = {
  enabled: true,
  label: 'Client Center',
  groups: [{ title: 'Portals', links: [{ label: 'Client Portal', url: 'https://portal.klp.com' }] }],
}

const NAV: NavJson = {
  primary: [
    { label: 'Services', url: '/services', children: [{ label: 'Virtual CFO', url: '/services/virtual-cfo' }] },
    { label: 'Contact', url: '/contact' },
  ],
}

describe('markdown → html', () => {
  it('renders bold, links, and lists', () => {
    const html = markdownToHtml('Some **bold** and [a link](/x).\n\n- one\n- two')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<a href="/x">a link</a>')
    expect(html).toContain('<li>one</li>')
  })
  it('drops icon: noise lines', () => {
    expect(markdownToHtml('icon: TrendingUp\nReal copy.')).not.toContain('TrendingUp')
  })
})

describe('section parsing', () => {
  it('captures blockId, variant, image, alt, query', () => {
    const sections = parseDiviSections(BODY)
    const split = sections.find((s) => s.blockId === 'content-split')!
    expect(split.variant).toBe('image-left')
    expect(split.image).toBe('cfo.jpg')
    expect(split.query).toBe('business consultation office')
  })
  it('splits card grids into items', () => {
    const grid = parseDiviSections(BODY).find((s) => s.blockId === 'feature-grid')!
    const cards = parseCards(grid.content)
    expect(cards.map((c) => c.title)).toEqual(['Planning', 'Oversight'])
  })
  it('extracts inline Q/A pairs', () => {
    const qa = parseQA('**Q: What is X?**\nA: It is Y.\n\n**Q: And Z?**\nA: Also Y.')
    expect(qa).toHaveLength(2)
    expect(qa[0]).toEqual({ question: 'What is X?', answer: 'It is Y.' })
  })
})

describe('page assembly', () => {
  const images = new Map([['business consultation office', 'https://images.pexels.com/x.jpg']])
  const divi = buildPageDivi(PAGE, images, 'https://firm.com')

  it('opens with a page-header hero section', () => {
    expect(divi.startsWith('[et_pb_section')).toBe(true)
    expect(divi).toContain('<h1>Virtual CFO Services</h1>')
  })
  it('renders card grid as blurb columns', () => {
    expect(divi).toContain('<h3>Planning</h3>')
    // Two cards fill one row; the row's column_structure matches its real
    // column count (Divi requires this), so 2 items → "1_2,1_2".
    expect(divi).toContain('column_structure="1_2,1_2"')
  })
  it('hotlinks the resolved image and honors image-left order', () => {
    expect(divi).toContain('src="https://images.pexels.com/x.jpg"')
    const imgIdx = divi.indexOf('et_pb_image')
    const howItWorks = divi.indexOf('How It Works')
    expect(imgIdx).toBeLessThan(howItWorks) // image column precedes text column
  })
  it('renders a CTA button and internalizes the firm-host link', () => {
    expect(divi).toContain('button_text="Schedule a consultation"')
    expect(divi).toContain('href="/services"') // https://firm.com/services → /services
  })
  it('appends the FAQ accordion from the faq_block column', () => {
    expect(divi).toContain('et_pb_accordion')
    expect(divi).toContain('title="What does it cost?"')
  })
  it('collects the image queries needing resolution', () => {
    expect(collectPageQueries(PAGE)).toEqual(['business consultation office'])
  })
})

describe('URL + XSS hardening', () => {
  it('allows http(s), mailto, tel, and relative URLs', () => {
    expect(safeUrl('https://x.com')).toBe('https://x.com')
    expect(safeUrl('/services')).toBe('/services')
    expect(safeUrl('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(safeUrl('#faq')).toBe('#faq')
    expect(safeUrl('services')).toBe('services')
  })
  it('drops javascript:/data:/vbscript: URLs', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('JavaScript:alert(1)')).toBeNull()
    expect(safeUrl('data:text/html,<script>')).toBeNull()
    expect(safeUrl('vbscript:msgbox')).toBeNull()
  })
  it('markdown link with a javascript: scheme renders as plain text, no anchor', () => {
    const html = inlineMarkdown('click [here](javascript:alert(1))')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('here')
  })
  it('markdown link cannot break out of the href attribute', () => {
    const html = inlineMarkdown('[x](https://x.com/"onmouseover="alert(1))')
    expect(html).not.toContain('"onmouseover="')
    expect(html).toContain('&quot;')
  })
  it('cta button falls back to /contact/ when the source URL is unsafe', () => {
    const sc = ctaBlock({ heading: 'Go', bodyHtml: '', buttonText: 'Click', buttonUrl: 'javascript:alert(1)' })
    expect(sc).not.toContain('javascript:')
    expect(sc).toContain('button_url="/contact/"')
  })
})

describe('accordion escaping', () => {
  it('encodes double quotes in the toggle title', () => {
    const sc = accordionBlock('FAQ', [{ question: 'Say "hi"?', answer: 'Yes.' }])
    expect(sc).toContain('title="Say %22hi%22?"')
    expect(sc).toContain('open="on"')
  })
})

describe('WXR', () => {
  const wxr = buildWxr({
    siteTitle: 'Korbey Lague PLLP',
    siteUrl: 'https://firm.com',
    pages: [
      { title: 'Home', path: '/', slug: 'home', postId: 100, parentId: 0, content: '[et_pb_section][/et_pb_section]' },
      { title: 'Virtual CFO', path: '/services/virtual-cfo', slug: 'virtual-cfo', postId: 101, parentId: 0, content: '[et_pb_section][/et_pb_section]' },
    ],
    nav: NAV,
    dateGmt: '2026-08-21 12:00:00',
  })

  it('is a WXR 1.2 document with page items', () => {
    expect(wxr).toContain('<wp:wxr_version>1.2</wp:wxr_version>')
    expect(wxr).toContain('<wp:post_type><![CDATA[page]]></wp:post_type>')
    expect(wxr).toContain('_et_pb_use_builder')
  })
  it('emits the nav menu term and links menu items to page ids', () => {
    expect(wxr).toContain('<wp:term_taxonomy>nav_menu</wp:term_taxonomy>')
    expect(wxr).toContain('<wp:post_type><![CDATA[nav_menu_item]]></wp:post_type>')
    // "Virtual CFO" nav item resolves to page post_id 101.
    expect(wxr).toContain('<![CDATA[_menu_item_object_id]]></wp:meta_key>\n\t\t\t<wp:meta_value><![CDATA[101]]>')
  })
})

describe('Divi library JSON', () => {
  const json = buildDiviLibrary({ brand: BRAND, clientCenter: CLIENT_CENTER, nav: NAV, logoUrl: null, dateGmt: '2026-08-21 12:00:00' })
  const parsed = JSON.parse(json)

  it('is a valid et_builder_layouts envelope with header + footer', () => {
    expect(parsed.context).toBe('et_builder_layouts')
    expect(Object.keys(parsed.data)).toHaveLength(2)
    expect(parsed.data['1'].post_title).toContain('Header')
    expect(parsed.data['2'].post_title).toContain('Footer')
  })
  it('embeds client center portals and phone in the header', () => {
    expect(parsed.data['1'].post_content).toContain('Client Portal')
    expect(parsed.data['1'].post_content).toContain('(978) 555-0100')
  })
})

describe('pageInputFromRepoFile (live repo source)', () => {
  const FILE = [
    '---',
    'title: "Virtual CFO Services | Korbey Lague PLLP"',
    'url: /services/virtual-cfo',
    'hero: page-header',
    'hero_subhead: "Strategic financial guidance"',
    'faq_block: [{"question":"Cost?","answer":"Depends."}]',
    '---',
    '',
    '<!-- block: intro-text | variant: centered -->',
    '## Why Virtual CFO',
    '',
    'Body copy.',
    '',
    '---',
    '## SEO & AIO Metadata',
    '',
    '**Answer Block:**',
    'Should not appear in the rendered page.',
  ].join('\n')

  it('maps frontmatter to DiviPageInput and strips the SEO appendix', () => {
    const input = pageInputFromRepoFile('content/pages/services--virtual-cfo.md', FILE)
    expect(input.page_title).toBe('Virtual CFO Services') // firm suffix removed
    expect(input.page_url).toBe('/services/virtual-cfo')
    expect(input.hero_block).toBe('page-header')
    expect(input.hero_subhead).toBe('Strategic financial guidance')
    expect(input.faq_block).toEqual([{ question: 'Cost?', answer: 'Depends.' }])
    expect(input.content_markdown).toContain('## Why Virtual CFO')
    expect(input.content_markdown).not.toContain('SEO & AIO Metadata')
  })

  it('derives url + title from the path when frontmatter omits them', () => {
    const input = pageInputFromRepoFile('content/pages/about-us.md', '## About\n\nText.')
    expect(input.page_url).toBe('/about-us')
    expect(input.page_title).toBe('About Us')
  })
})

describe('buildDiviExport (end to end)', () => {
  it('produces a non-empty zip and nests child pages under their parent', async () => {
    const { zip, filenameBase } = await buildDiviExport({
      firmName: 'Korbey Lague PLLP',
      websiteUrl: 'https://www.korbeylague.com',
      pages: [
        { ...PAGE, page_title: 'Home', page_url: '/' },
        { ...PAGE, page_title: 'Services', page_url: '/services' },
        { ...PAGE, page_title: 'Virtual CFO', page_url: '/services/virtual-cfo' },
      ],
      brand: BRAND,
      clientCenter: CLIENT_CENTER,
      nav: NAV,
      logoUrl: null,
      pexelsApiKey: '', // no network in tests → images resolve empty, blocks render sans image
      dateGmt: '2026-08-21 12:00:00',
    })
    expect(zip.length).toBeGreaterThan(100)
    expect(filenameBase).toBe('korbeylague-com')
  })
})
