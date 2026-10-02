// The Divi export carries the Theme Studio / Design Studio look: radius tokens,
// style axes, layout presets, treatments, logos and uploaded images.
import { describe, expect, it } from 'vitest'
import { applyDiviStyle, brandCss, buildDiviStyle, defaultDesignJson, parseDesignJsonText, radiusPx } from './style'
import { styleOverrides } from './customizer'
import { buildPageDivi, collectPageQueries, effectiveLayout, type DiviPageInput } from './page'
import { parseDiviSections } from './blocks'
import { repoAssetResolver } from './images'
import { buildDiviLibrary } from './library'
import { unportedCssAreas } from './index'
import { buildReadme } from './readme'
import { pageInputFromRepoFile } from './from-frontmatter'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'

const BRAND: BrandJson = {
  firm: { name: 'Slachta CPA' },
  contact: { phone: '(555) 010-0100' },
  palette: { primary: '#1F3A5F', secondary: '#B5651D', complementary: '#B5651D', action: '#B5651D', nearBlack: '#1C1917', nearWhite: '#FAFAF9' },
  social: [],
  certifications: [],
  logo: { primary: 'logo-abc123.svg', alt: 'Slachta logo', footer: 'logo-footer-def456.png' },
}

const design = (over: Partial<DesignJson> = {}): DesignJson => ({ ...defaultDesignJson(), ...over })
const SITE = 'https://slachta.vercel.app/'
const assets = repoAssetResolver(SITE)

function page(body: string, extra: Partial<DiviPageInput> = {}): DiviPageInput {
  return {
    page_title: 'Home',
    page_url: '/',
    hero_block: 'page-header',
    hero_variant: null,
    hero_image_alt: null,
    hero_subhead: null,
    hero_image_query: null,
    content_markdown: body,
    faq_block: [],
    cta: null,
    ...extra,
  }
}

const CARDS = '### One\nFirst.\n\n### Two\nSecond.\n\n### Three\nThird.'

describe('design tokens', () => {
  it('reads radius tokens from design.json (px and rem)', () => {
    const s = buildDiviStyle(BRAND, design({ radius: { none: '0px', sm: '2px', md: '0.75rem', lg: '20px', pill: '6px' } }))
    expect(s.radius).toEqual({ button: '6px', card: '12px', image: '12px' })
    expect(radiusPx('9999px')).toBe(9999)
    expect(radiusPx('calc(1px)')).toBeNull()
  })

  it('caps a 9999px pill at 40px for Divi', () => {
    const s = buildDiviStyle(BRAND, design({ radius: { ...defaultDesignJson().radius, pill: '9999px' } }))
    expect(s.radius.button).toBe('40px')
    expect(styleOverrides(s).all_buttons_border_radius).toBe('40')
  })

  it('keeps valid style axes + layout presets and drops unknown values', () => {
    const d = parseDesignJsonText(
      JSON.stringify({ ...defaultDesignJson(), style: { cards: 'outlined', nav: 'sideways' }, layout: { faq: 'split', bogus: 'x' } })
    )
    expect(d.style).toEqual({ cards: 'outlined' })
    expect(d.layout).toEqual({ faq: 'split' })
  })
})

describe('style axes', () => {
  it('buttons: pill / sharp set the radius token, bold adds the label treatment', () => {
    expect(buildDiviStyle(BRAND, design({ style: { buttons: 'pill' } })).radius.button).toBe('40px')
    expect(buildDiviStyle(BRAND, design({ style: { buttons: 'sharp' } })).radius.button).toBe('0px')
    expect(brandCss(buildDiviStyle(BRAND, design({ style: { buttons: 'bold' } })))).toContain('text-transform: uppercase; letter-spacing: 0.08em')
  })

  it('cards, hero scale and image treatment emit their Divi rules', () => {
    const css = brandCss(
      buildDiviStyle(BRAND, design({ style: { cards: 'outlined', heroScale: 'dramatic', imageTreatment: 'mono' } }))
    )
    expect(css).toMatch(/\.c5-card[^{]*\{ box-shadow: none !important; border: 1px solid rgba/)
    expect(css).toContain('body .c5-display { font-size: clamp(3rem')
    expect(css).toContain('body .c5-frame img { filter: grayscale(1)')
  })

  it('rounded images use the lg radius; section rhythm scales the padding', () => {
    const s = buildDiviStyle(BRAND, design({ style: { imageTreatment: 'rounded', sectionRhythm: 'compact' } }))
    expect(s.radius.image).toBe('16px')
    expect(s.paddingFactor).toBe(0.75)
  })

  it('an untouched design emits no axis rules', () => {
    const css = brandCss(buildDiviStyle(BRAND, design()))
    expect(css).not.toContain('.c5-card:hover { box-shadow: none')
    expect(css).not.toContain('grayscale')
    expect(css).not.toContain('letter-spacing: 0.08em')
  })

  it('headline accent: action-colour serif by default, underline/plain per axis', () => {
    expect(brandCss(buildDiviStyle(BRAND, design()))).toContain('body h1 em, body h2 em { color: var(--c5-link); }')
    expect(brandCss(buildDiviStyle(BRAND, design({ style: { accentUsage: 'underline' } })))).toContain('text-decoration: underline')
    const plain = brandCss(buildDiviStyle(BRAND, design({ style: { accentUsage: 'plain' } })))
    expect(plain).toContain('body h1 em, body h2 em { font-style: normal; }')
    expect(plain).not.toContain('var(--c5-font-accent); }\nbody h1 em')
  })

  it('mono eyebrows switch the hero eyebrow to the mono stack', () => {
    expect(brandCss(buildDiviStyle(BRAND, design({ eyebrowStyle: 'mono' })))).toContain('body .c5-eyebrow { font-family: ui-monospace')
    expect(brandCss(buildDiviStyle(BRAND, design()))).not.toContain('ui-monospace')
  })
})

describe('layout variants + presets', () => {
  const s = (annotation: string, body = CARDS) => parseDiviSections(`${annotation}\n## Heading\n\n${body}`)[0]

  it('an explicit layout variant wins, then the preset, never on an ink band', () => {
    expect(effectiveLayout(s('<!-- block: service-cards | variant: list -->'), {})).toBe('list')
    expect(effectiveLayout(s('<!-- block: service-cards | variant: 2-col -->'), { cards: 'list' })).toBe('list')
    expect(effectiveLayout(s('<!-- block: feature-grid | theme: ink -->'), { cards: 'list' })).toBeUndefined()
    expect(effectiveLayout(s('<!-- block: faq-accordion -->'), { cards: 'list' })).toBeUndefined()
  })

  it('cards list preset renders one card per row', () => {
    const out = buildPageDivi(page('<!-- block: service-cards | variant: 3-col -->\n## Services\n\n' + CARDS), new Map(), SITE, null, { layout: { cards: 'list' } })
    expect(out).toContain('column_structure="4_4"')
    expect(out).not.toContain('column_structure="1_3,1_3,1_3"')
  })

  it('content-cards now render as a card grid', () => {
    const out = buildPageDivi(page('<!-- block: content-cards -->\n## Reading\n\n' + CARDS), new Map(), SITE)
    expect(out).toContain('module_class="c5-card"')
  })

  it('ctaBanner centered preset + image-bg variant', () => {
    const md = '<!-- block: cta-banner | variant: image-bg | image: banner-1.webp -->\n## Talk to us\n\n[Book a call](/contact)'
    const out = buildPageDivi(page(md), new Map(), SITE, null, { layout: { ctaBanner: 'centered' }, assetUrl: assets.url })
    expect(out).toContain('background_image="https://slachta.vercel.app/content-assets/banner-1.webp"')
    expect(out).toContain('text_orientation="center"')
    expect(out).not.toContain('column_structure="2_3,1_3"')
  })

  it('faq split preset puts the heading in a left column', () => {
    const md = '<!-- block: faq-accordion -->\n## Questions\n\n**Q: Why?**\nA: Because.'
    expect(buildPageDivi(page(md), new Map(), SITE, null, { layout: { faq: 'split' } })).toContain('column_structure="1_3,2_3"')
    expect(buildPageDivi(page(md), new Map(), SITE)).not.toContain('column_structure="1_3,2_3"')
  })

  it('theme: ink applies to prose blocks like stats-bar', () => {
    const out = buildPageDivi(page('<!-- block: stats-bar | variant: 3-up | theme: ink -->\n## By the numbers\n\n- 30 years'), new Map(), SITE)
    expect(out).toContain('background_color="{{c5:band}}"')
    expect(out).toContain('text_text_color="{{c5:onBand}}"')
  })

  it('intro-text is centred unless left-aligned', () => {
    const center = buildPageDivi(page('<!-- block: intro-text | variant: centered -->\n## Hi\n\nCopy.'), new Map(), SITE)
    const left = buildPageDivi(page('<!-- block: intro-text | variant: left-aligned -->\n## Hi\n\nCopy.'), new Map(), SITE)
    expect(center).toContain('text_orientation="center"')
    expect(left.split('[et_pb_text')[2]).not.toContain('text_orientation="center"')
  })
})

describe('uploaded images', () => {
  const md = '<!-- block: content-split | variant: image-left | image: team-photo.jpg | alt: "The team" | query: "accountants office" -->\n## Our team\n\nCopy.'

  it('resolves filenames, root paths and absolute URLs; rejects traversal', () => {
    expect(assets.url('a b.webp')).toBe('https://slachta.vercel.app/content-assets/a%20b.webp')
    expect(assets.url('/images/x.png')).toBe('https://slachta.vercel.app/images/x.png')
    expect(assets.url('https://cdn.example.com/x.jpg')).toBe('https://cdn.example.com/x.jpg')
    expect(assets.url('../../etc/passwd')).toBeNull()
    expect(repoAssetResolver(null).url('x.jpg')).toBeNull()
    expect(repoAssetResolver(null).linked).toBe(false)
    expect(assets.origin).toBe('https://slachta.vercel.app')
    expect(repoAssetResolver('javascript:alert(1)').linked).toBe(false)
  })

  it('an uploaded image beats the stock query', () => {
    const stock = new Map([['accountants office', 'https://images.pexels.com/stock.jpg']])
    const out = buildPageDivi(page(md), stock, SITE, null, { assetUrl: assets.url })
    expect(out).toContain('src="https://slachta.vercel.app/content-assets/team-photo.jpg"')
    expect(out).not.toContain('pexels')
    // Without a known site address the stock photo still fills the slot.
    expect(buildPageDivi(page(md), stock, SITE)).toContain('pexels.com/stock.jpg')
  })

  it('skips stock lookups for slots with an uploaded image', () => {
    expect(collectPageQueries(page(md), assets.url)).toEqual([])
    expect(collectPageQueries(page(md))).toEqual(['accountants office'])
  })

  it('a reference to a file missing from the repo falls back to the stock query', () => {
    const known = repoAssetResolver(SITE, new Set(['other.jpg']))
    expect(known.url('team-photo.jpg')).toBeNull()
    expect(known.url('other.jpg')).toBe('https://slachta.vercel.app/content-assets/other.jpg')
    expect(collectPageQueries(page(md), known.url)).toEqual(['accountants office'])
  })

  it('reads the template hero fields from repo frontmatter', () => {
    const file = [
      '---',
      'title: "Home | Slachta"',
      'hero: hero',
      'hero_headline: "Numbers you can *trust*"',
      'hero_eyebrow: "Since 1994"',
      'hero_image: hero-office.webp',
      'hero_cta_label: "Book a call"',
      'hero_cta_url: /contact',
      '---',
      '',
    ].join('\n')
    const p = pageInputFromRepoFile('content/pages/home.md', file)
    expect(p).toMatchObject({ hero_headline: 'Numbers you can *trust*', hero_eyebrow: 'Since 1994', hero_image: 'hero-office.webp', cta: { text: 'Book a call', url: '/contact' } })
    const out = buildPageDivi(p, new Map(), SITE, null, { assetUrl: assets.url })
    expect(out).toContain('<p class="c5-eyebrow">Since 1994</p><h1 class="c5-display">Numbers you can <em>trust</em></h1>')
    expect(out).toContain('src="https://slachta.vercel.app/content-assets/hero-office.webp"')
    expect(out).toContain('button_text="Book a call"')
  })
})

describe('header + footer', () => {
  const lib = (d: DesignJson, brand: BrandJson = BRAND, footerLogoUrl: string | null = null) => {
    const style = buildDiviStyle(brand, d)
    const json = JSON.parse(
      buildDiviLibrary({ brand, clientCenter: { enabled: false, label: 'Client Center', groups: [] }, nav: { primary: [] }, logoUrl: 'https://slachta.vercel.app/content-assets/logo-abc123.svg', footerLogoUrl, style, dateGmt: '2026-10-02 12:00:00' })
    )
    return { header: json.data['1'].post_content as string, footer: json.data['2'].post_content as string, style }
  }

  it('nav inverted paints the bar primary with light links and a light logo plate', () => {
    const { header, style } = lib(design({ style: { nav: 'inverted' } }))
    expect(header).toContain(`background_color="${style.derived.primarySurface}"`)
    expect(header).toContain(`menu_text_color="${style.derived.onPrimary}"`)
    expect(header).toMatch(/et_pb_image[^\]]*background_color="#FAFAF9"/)
  })

  it('nav bordered adds the brand rule', () => {
    expect(lib(design({ style: { nav: 'bordered' } })).header).toContain('border_width_bottom="2px" border_color_bottom="#1F3A5F"')
  })

  it('logo size large and a light-tone logo plate', () => {
    const { header } = lib(design({ logo: { size: 'large' } }), { ...BRAND, logo: { ...BRAND.logo, tone: 'light' } })
    expect(header).toContain('max_height="44px"')
    expect(header).toMatch(/et_pb_image[^\]]*background_color="#1C1917"/)
    expect(lib(design()).header).toContain('max_height="32px"')
  })

  it('footer surface follows the footer axis', () => {
    const base = lib(design())
    expect(base.footer).toContain('background_color="#1C1917"')
    const light = lib(design({ style: { footer: 'light' } }))
    expect(light.footer).toContain(`background_color="${light.style.derived.surfaceMuted}"`)
    const brand = lib(design({ style: { footer: 'brand' } }))
    expect(brand.footer).toContain(`background_color="${brand.style.derived.primarySurface}"`)
  })

  it('uses the dedicated footer logo, else the primary knocked out to white', () => {
    const footerLogo = 'https://slachta.vercel.app/content-assets/logo-footer-def456.png'
    const withFooter = lib(design(), BRAND, footerLogo).footer
    expect(withFooter).toContain(`src="${footerLogo}"`)
    expect(withFooter).not.toContain('filter_invert')
    const primaryOnly = lib(design()).footer
    expect(primaryOnly).toContain('logo-abc123.svg')
    expect(primaryOnly).toContain('filter_brightness="0%" filter_invert="100%"')
  })
})

describe('what does not transfer', () => {
  it('lists the Design Studio CSS areas from design-overrides.css', () => {
    const css = [
      '/* design-studio:begin */',
      '/* design-studio:locks */',
      ':where([data-block="hero"]) { --color-primary: #000; }',
      '/* /design-studio:locks */',
      '/* design-studio:global */',
      'a { color: var(--color-action); }',
      '/* /design-studio:global */',
      '/* design-studio:hero */',
      '[data-block="hero"] h1 { letter-spacing: 0; }',
      '/* /design-studio:hero */',
      '/* design-studio:end */',
    ].join('\n')
    expect(unportedCssAreas(css)).toEqual(['site-wide', 'hero', 'locked areas'])
    expect(unportedCssAreas('')).toEqual([])
  })

  it('the README names linked uploads and the dropped CSS areas', () => {
    const readme = buildReadme({
      firmName: 'Slachta CPA',
      filenameBase: 'slachta',
      pageCount: 5,
      imageCount: 2,
      hasLogo: true,
      logoExpires: false,
      navConfigured: true,
      menuPageCount: 5,
      notInNavCount: 0,
      hasSitemapPdf: true,
      hasSitemapPng: true,
      fonts: { heading: 'Inter', body: 'Inter' },
      uploadedImageCount: 3,
      uploadsPlaced: 2,
      missingUploads: [],
      uploadsLinked: true,
      siteUrl: 'https://slachta.vercel.app',
      unportedCss: ['site-wide', 'hero'],
    })
    expect(readme).toContain('2 uploaded image(s)')
    expect(readme).toContain('1 more uploaded image(s) sit in blocks that export as text')
    expect(readme).toContain('https://slachta.vercel.app/content-assets/')
    expect(readme).toContain('NOT carried over (2 area(s): site-wide, hero)')
    expect(readme).toContain('hot-linked from the live site')
    expect(readme).not.toContain('EXPIRES')
  })

  it('resolves tokens in the new templates', () => {
    const style = buildDiviStyle(BRAND, design({ darkSections: true }))
    const out = applyDiviStyle(
      buildPageDivi(page('<!-- block: stats-bar | theme: ink -->\n## Stats\n\n- 1'), new Map(), SITE),
      style
    )
    expect(out).not.toContain('{{')
    expect(out).toContain(`background_color="${style.derived.ink}"`)
  })
})
