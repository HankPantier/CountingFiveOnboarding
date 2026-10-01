import { describe, expect, it, vi } from 'vitest'
import { defaultDesignJson } from './style'
import { unzipSync, strFromU8 } from 'fflate'
import { buildSitemapModel, sidebarOrder, flattenMenu, type SitemapPageRec } from './sitemap'
import { layoutSitemap, sitemapTheme } from './sitemap-layout'
import { renderSitemapSvg } from './sitemap-svg'
import { renderSitemapPdf } from './sitemap-pdf'
import { renderSitemapPng } from './sitemap-png'
import { buildDiviExport, type DiviPageInput } from './index'
import { analyzeNav } from './hierarchy'
import type { BrandJson } from '@/types/brand-json'
import type { NavJson } from '@/types/nav-json'

const PAGES: SitemapPageRec[] = [
  { path: '/', title: 'Home', synthesized: null, parentPath: null },
  { path: '/services', title: 'Services', synthesized: 'section', parentPath: null },
  { path: '/tax', title: 'Tax Planning', synthesized: null, parentPath: '/services', seo: { metaTitle: 'Tax | Firm', metaDescription: 'Tax help.', targetKeyword: 'tax planning' } },
  { path: '/contact', title: 'Contact', synthesized: null, parentPath: null },
  { path: '/privacy', title: 'Privacy', synthesized: null, parentPath: null },
  { path: '/about/history', title: 'History', synthesized: null, parentPath: null },
]

const NAV: NavJson = {
  primary: [
    { label: 'Services', url: '/services', children: [{ label: 'Tax', url: '/tax' }] },
    { label: 'Portal', url: 'https://portal.example.com' },
    { label: 'Contact', url: '/contact' },
  ],
  cta: { label: 'Book a call', url: '/contact' },
}

const model = buildSitemapModel({ firmName: 'Firm', generatedAt: '2026-10-01', pages: PAGES, nav: NAV })

describe('sitemap model', () => {
  it('numbers menu items in nav order with dotted dropdown positions', () => {
    const rows = flattenMenu(model.menu).map(({ node, depth }) => [node.menuPosition, node.title, depth])
    expect(rows).toEqual([
      ['1', 'Services', 0],
      ['1.1', 'Tax', 1],
      ['2', 'Portal', 0],
      ['3', 'Contact', 0],
    ])
  })

  it('keeps pages outside the nav in a separate group, sidebar-sorted', () => {
    expect(model.notInNav.map((n) => n.path)).toEqual(['/about/history', '/privacy'])
    expect(model.notInNav.every((n) => n.menuPosition === null)).toBe(true)
  })

  it('marks external menu items as links and auto-created sections', () => {
    const [services, portal] = model.menu
    expect(services.kind).toBe('synthesized-section')
    expect(portal.kind).toBe('custom-link')
    expect(portal.wpUrl).toBe('')
  })

  it('computes nested WordPress permalinks and parent titles', () => {
    const tax = model.menu[0].children[0]
    expect(tax.wpUrl).toBe('/services/tax')
    expect(tax.parentTitle).toBe('Services')
    expect(tax.seo.targetKeyword).toBe('tax planning')
  })

  it('counts pages and orders home → menu DFS → not-in-nav', () => {
    expect(model.counts).toEqual({ pages: 6, inMenu: 3, notInNav: 2, synthesized: 1 })
    expect(sidebarOrder(model)).toEqual(['/', '/services', '/tax', '/contact', '/about/history', '/privacy'])
    expect(model.navConfigured).toBe(true)
  })

  it('flags an empty nav as not configured', () => {
    const empty = buildSitemapModel({ firmName: 'Firm', generatedAt: '2026-10-01', pages: PAGES, nav: { primary: [] } })
    expect(empty.navConfigured).toBe(false)
    expect(empty.menu).toEqual([])
    expect(empty.notInNav).toHaveLength(5)
  })
})

describe('sitemap renderers', () => {
  const theme = sitemapTheme({ primary: '#0A6E7A', nearBlack: '#1A1A1A' })
  const layout = layoutSitemap(model)

  it('lays out one column per top-level menu item plus the not-in-nav group', () => {
    expect(layout.groups).toHaveLength(1)
    expect(layout.boxes.filter((b) => b.variant === 'loose')).toHaveLength(2)
    expect(layout.boxes.filter((b) => b.variant === 'top')).toHaveLength(2) // Portal is a link
    expect(layout.width).toBeGreaterThan(0)
  })

  it('renders an SVG naming every page and escaping text', () => {
    const svg = renderSitemapSvg(layout, theme)
    for (const title of ['Services', 'Tax', 'Portal', 'Contact', 'Privacy', 'History', 'Book a call']) {
      expect(svg).toContain(title)
    }
    expect(svg).toContain('#0A6E7A')
    const evil = buildSitemapModel({
      firmName: 'A & <B>',
      generatedAt: '2026-10-01',
      pages: [{ path: '/', title: 'Home', synthesized: null, parentPath: null }],
      nav: { primary: [] },
    })
    const evilSvg = renderSitemapSvg(layoutSitemap(evil), theme)
    expect(evilSvg).toContain('A &amp; &lt;B&gt;')
    expect(evilSvg).not.toContain('<B>')
  })

  it('falls back to a neutral palette for non-hex brand colours', () => {
    expect(sitemapTheme({ primary: 'red"/><script>' }).primary).toBe('#231F20')
  })

  it('renders a real PDF', async () => {
    const pdf = await renderSitemapPdf(model, layout, theme)
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 30_000)

  it('rasterizes the SVG to PNG', async () => {
    const png = await renderSitemapPng(renderSitemapSvg(layout, theme), layout.width)
    expect(png?.subarray(1, 4).toString('latin1')).toBe('PNG')
  }, 30_000)

  it('returns null instead of throwing when the PNG renderer fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await renderSitemapPng('<not-svg', 100)).toBeNull()
    warn.mockRestore()
  })
})

describe('nav parity with the editor sidebar', () => {
  it('resolves an absolute self-host nav url to its page, not an external link', () => {
    const { resolvedNav } = analyzeNav(
      { primary: [{ label: 'About', url: 'https://www.firm.com/about/' }, { label: 'Ext', url: 'https://other.com/x' }] },
      { pagePaths: new Set(['/about']), siteHost: 'firm.com' }
    )
    expect(resolvedNav.primary[0].url).toBe('/about')
    expect(resolvedNav.primary[1].url).toBe('https://other.com/x')
  })

  it('treats a same-host absolute url as internal even without a matching page', () => {
    const { resolvedNav } = analyzeNav({ primary: [{ label: 'X', url: 'https://firm.com/x' }] }, { siteHost: 'www.firm.com' })
    expect(resolvedNav.primary[0].url).toBe('/x')
  })
})

describe('buildDiviExport — menu, order and sitemap files', () => {
  const page = (title: string, url: string): DiviPageInput => ({
    page_title: title,
    page_url: url,
    hero_block: 'page-header',
    hero_variant: null,
    hero_image_alt: null,
    hero_subhead: null,
    hero_image_query: null,
    content_markdown: '## Body\n\nText.',
    faq_block: [],
    cta: null,
  })
  const BRAND: BrandJson = {
    firm: { name: 'Firm' },
    contact: { phone: '', address: { street: '', city: '', state: '', zip: '' } },
    palette: { primary: '#0A6E7A', secondary: '#00C1DE', complementary: '#00C1DE', action: '#00C1DE', nearBlack: '#231F20', nearWhite: '#F7FAFC' },
    social: [],
    certifications: [],
    logo: { primary: '', alt: '' },
  }
  const run = (nav: NavJson) =>
    buildDiviExport({
      firmName: 'Firm',
      websiteUrl: 'https://www.firm.com',
      pages: [page('Home', '/'), page('Zeta', '/zeta'), page('About', '/about'), page('Privacy', '/privacy')],
      brand: BRAND,
      design: defaultDesignJson(),
      clientCenter: { enabled: false, label: 'Client Center', groups: [] },
      nav,
      logoUrl: null,
      pexelsApiKey: '',
      dateGmt: '2026-10-01 12:00:00',
    })
  const files = async (nav: NavJson) => {
    const out = unzipSync(new Uint8Array((await run(nav)).zip))
    return { names: Object.keys(out), wxr: strFromU8(out['firm-com.wxr']), out }
  }
  const menuOrderOf = (wxr: string, title: string) =>
    Number(wxr.match(new RegExp(`<title><!\\[CDATA\\[${title}\\]\\]></title>[\\s\\S]*?<wp:menu_order>(\\d+)</wp:menu_order>`))?.[1])

  it('ships the sitemap PDF, SVG and PNG alongside the WXR', async () => {
    const { names, out } = await files({ primary: [{ label: 'About', url: '/about' }] })
    expect(names).toEqual(
      expect.arrayContaining(['firm-com.wxr', 'firm-com-sitemap.pdf', 'firm-com-sitemap.svg', 'firm-com-sitemap.png', 'README.txt'])
    )
    const readme = strFromU8(out['README.txt'])
    expect(readme).toContain('firm-com-sitemap.pdf')
    expect(readme).toContain('NOT assigned to any menu')
  }, 60_000)

  it('orders pages like the sidebar and links absolute self-host nav urls to pages', async () => {
    const { wxr } = await files({
      primary: [
        { label: 'Zeta', url: 'https://www.firm.com/zeta' },
        { label: 'About', url: '/about' },
      ],
    })
    expect(menuOrderOf(wxr, 'Home')).toBe(0)
    expect(menuOrderOf(wxr, 'Zeta')).toBe(1)
    expect(menuOrderOf(wxr, 'About')).toBe(2)
    expect(menuOrderOf(wxr, 'Privacy')).toBe(3)
    // The Zeta menu item is a page link, not a custom link back to the old domain.
    expect(wxr).not.toContain('https://www.firm.com/zeta]]></wp:meta_value>')
    expect((wxr.match(/<wp:post_type><!\[CDATA\[nav_menu_item\]\]><\/wp:post_type>/g) ?? []).length).toBe(2)
  }, 60_000)

  it('leaves not-in-nav pages out of the menu and ships an empty menu when nav is missing', async () => {
    const { wxr, out } = await files({ primary: [] })
    expect(wxr).not.toContain('nav_menu_item')
    expect(wxr).toContain('<title><![CDATA[Privacy]]></title>')
    expect(strFromU8(out['README.txt'])).toContain('imports\nEMPTY')
  }, 60_000)
})
