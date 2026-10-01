import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import {
  applyDiviStyle,
  BRAND_CSS_END,
  BRAND_CSS_START,
  buildDiviStyle,
  c5,
  defaultDesignJson,
  encodeGlobalColorsInfo,
  gcidFor,
  pad,
  parseDesignJsonText,
} from './style'
import { buildDiviCustomizer, composeCustomCss, CUSTOMIZER_BASE, styleOverrides } from './customizer'
import { buildDiviExport, type DiviPageInput } from './index'
import { cardGridBlock } from './blocks'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'

const PALETTE: BrandJson['palette'] = {
  primary: '#7A1F3D',
  secondary: '#2E6F5E',
  complementary: '#D9A441',
  action: '#C2410C',
  nearBlack: '#1C1917',
  nearWhite: '#FAFAF9',
}
const DESIGN: DesignJson = {
  ...defaultDesignJson(),
  typography: {
    headingFont: 'Playfair Display',
    bodyFont: 'Source Sans 3',
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Source+Sans+3:wght@400;600&display=swap',
    accentFont: 'Fraunces',
  },
  roundness: 'pill',
  density: 'airy',
}
const style = buildDiviStyle({ palette: PALETTE }, DESIGN)

describe('buildDiviStyle', () => {
  it('carries the palette, fonts and roundness/density tokens', () => {
    expect(style.palette.primary).toBe('#7A1F3D')
    expect(style.fonts).toMatchObject({ heading: 'Playfair Display', body: 'Source Sans 3' })
    expect(style.radius.button).toBe('40px')
    expect(style.paddingFactor).toBe(1.25)
  })

  it('strips CSS-breaking characters from font names and rejects non-Google font URLs', () => {
    const evil = buildDiviStyle(
      { palette: PALETTE },
      { ...DESIGN, typography: { ...DESIGN.typography, headingFont: 'X"; } body{}', googleFontsUrl: 'https://evil.example/x.css' } }
    )
    expect(evil.fonts.heading).not.toMatch(/["{};]/)
    expect(evil.fonts.googleFontsUrl).toBeNull()
  })

  it('falls back to template defaults for a missing or broken design.json', () => {
    expect(parseDesignJsonText(null).typography.headingFont).toBeTruthy()
    expect(parseDesignJsonText('{nope').roundness).toBe('soft')
    expect(parseDesignJsonText('{"roundness":"sharp"}').typography.bodyFont).toBeTruthy()
  })
})

describe('applyDiviStyle', () => {
  it('resolves colour tokens and links palette attrs to Global Colors', () => {
    const out = applyDiviStyle(
      `[et_pb_button button_text_color="${c5('onAction')}" button_bg_color="${c5('action')}" box_shadow_color="${c5('action', 0.35)}" global_colors_info="{}"][/et_pb_button]`,
      style
    )
    expect(out).toContain('button_bg_color="#C2410C"')
    expect(out).toContain('box_shadow_color="rgba(194,65,12,0.35)"')
    expect(out).toContain(`%22${gcidFor('action')}%22:%91%22button_bg_color%22%93`)
    expect(out).not.toContain('box_shadow_color%22') // tints are never linked
    expect(out).not.toContain('{{')
  })

  it('links a derived role when it equals a palette colour', () => {
    const out = applyDiviStyle(`[et_pb_text text_text_color="${c5('text')}" global_colors_info="{}"]x[/et_pb_text]`, style)
    expect(out).toContain(`%22${gcidFor('nearBlack')}%22:%91%22text_text_color%22%93`)
  })

  it('resolves tokens in content (inline styles) without touching the tag info', () => {
    const out = applyDiviStyle(`[et_pb_text global_colors_info="{}"]<p style="color:${c5('primary')}">x</p>[/et_pb_text]`, style)
    expect(out).toContain('global_colors_info="{}"]<p style="color:#7A1F3D">')
  })

  it('scales section padding by density', () => {
    expect(applyDiviStyle(`[et_pb_section custom_padding="${pad(60)}||${pad(60)}|||" global_colors_info="{}"]`, style)).toContain(
      'custom_padding="75px||75px|||"'
    )
  })

  it('encodes multiple links per Global Color', () => {
    expect(encodeGlobalColorsInfo(new Map([['gcid-a', ['x', 'y']]]))).toBe('{%22gcid-a%22:%91%22x%22,%22y%22%93}')
  })

  it('renders a theme: ink band on the deep ink surface only when darkSections is on', () => {
    const grid = cardGridBlock('Industries', [{ title: 'A', bodyHtml: '<p>a</p>' }], 1, 'ink')
    const light = applyDiviStyle(grid, style)
    const dark = applyDiviStyle(grid, buildDiviStyle({ palette: PALETTE }, { ...DESIGN, darkSections: true }))
    expect(light).toContain(`background_color="${style.derived.primarySurface}"`)
    expect(dark).toContain(`background_color="${buildDiviStyle({ palette: PALETTE }, { ...DESIGN, darkSections: true }).derived.ink}"`)
  })

  it('throws on an unknown role so a template typo cannot ship', () => {
    expect(() => applyDiviStyle('[et_pb_text a="{{c5:nope}}" global_colors_info="{}"]', style)).toThrow(/Unknown/)
  })
})

describe('Customizer import file', () => {
  const parsed = JSON.parse(buildDiviCustomizer(style)) as typeof CUSTOMIZER_BASE
  const overrides = styleOverrides(style)

  it('keeps the base envelope and every base key (Divi resets anything missing)', () => {
    expect(parsed.context).toBe('et_divi_mods')
    for (const key of Object.keys(CUSTOMIZER_BASE.data)) expect(parsed.data).toHaveProperty(key)
  })

  it('changes only the styling keys + Additional CSS', () => {
    const changed = Object.keys(parsed.data).filter(
      (k) => JSON.stringify(parsed.data[k]) !== JSON.stringify(CUSTOMIZER_BASE.data[k])
    )
    for (const k of changed) expect([...Object.keys(overrides), 'wp_custom_css']).toContain(k)
    expect(parsed.data.heading_font).toBe('Playfair Display')
    expect(parsed.data.all_buttons_bg_color).toBe('#C2410C')
    expect(parsed.data.all_buttons_border_radius).toBe('40')
    expect(parsed.data.body_header_size).toBe('48')
    expect(parsed.data.et_global_colors).toMatchObject({ [gcidFor('primary')]: { color: '#7A1F3D', active: 'yes' } })
  })

  it('puts the font @import first, keeps the boilerplate CSS, and appends the brand block last', () => {
    const css = parsed.data.wp_custom_css as string
    expect(css.startsWith('@import url("https://fonts.googleapis.com/css2?family=Playfair+Display')).toBe(true)
    expect(css).toContain('CLIENT CENTER MEGA MENU') // boilerplate CSS survives
    expect(css.trim().endsWith(BRAND_CSS_END)).toBe(true)
    expect(css).toContain('font-size: clamp(2rem, 1.3rem + 2.4vw, 3rem)')
  })

  it('imports the accent serif when serif headlines use it', () => {
    const serif = buildDiviStyle({ palette: PALETTE }, { ...DESIGN, headlineStyle: 'serif' })
    const css = composeCustomCss('body{}', serif)
    expect(css).toContain('family=Fraunces:wght@500;600;700')
    expect(composeCustomCss(css, serif).split('@import').length - 1).toBe(2)
  })

  it('is idempotent over an already-styled site (one brand block, one @import)', () => {
    const once = composeCustomCss('body{}', style)
    const twice = composeCustomCss(once, style)
    expect(twice.split(BRAND_CSS_START).length - 1).toBe(1)
    expect(twice.split('@import').length - 1).toBe(1)
  })
})

describe('export end to end — client palette, never the house colours', () => {
  const page = (title: string, url: string, body: string): DiviPageInput => ({
    page_title: title,
    page_url: url,
    hero_block: 'hero',
    hero_variant: null,
    hero_image_alt: null,
    hero_subhead: 'Sub',
    hero_image_query: null,
    content_markdown: body,
    faq_block: [{ question: 'Q?', answer: 'A.' }],
    cta: { text: 'Talk to us', url: '/contact' },
  })
  const BODY = [
    '<!-- block: feature-grid | variant: 3-col -->',
    '## Services',
    '',
    '### Tax',
    'Tax help.',
    '',
    '<!-- block: cta-banner -->',
    '## Ready?',
    '',
    '[Book](/contact)',
  ].join('\n')

  it('ships a Customizer file and no Revaltus navy/cyan anywhere in pages or layouts', async () => {
    const { zip } = await buildDiviExport({
      firmName: 'Firm',
      websiteUrl: 'https://firm.com',
      pages: [page('Home', '/', BODY), page('About', '/about', BODY)],
      brand: {
        firm: { name: 'Firm' },
        contact: { phone: '555', address: { street: '', city: '', state: '', zip: '' } },
        palette: PALETTE,
        social: [],
        certifications: [],
        logo: { primary: '', alt: '' },
      },
      design: DESIGN,
      clientCenter: { enabled: true, label: 'Client Center', groups: [{ title: 'P', links: [{ label: 'Portal', url: 'https://p.example.com' }] }] },
      nav: { primary: [{ label: 'About', url: '/about' }] },
      logoUrl: null,
      pexelsApiKey: '',
      dateGmt: '2026-10-01 12:00:00',
    })
    const files = unzipSync(new Uint8Array(zip))
    expect(Object.keys(files)).toContain('firm-com-divi-customizer.json')
    const wxr = strFromU8(files['firm-com.wxr'])
    const lib = strFromU8(files['firm-com-divi-library.json'])
    for (const text of [wxr, lib]) {
      expect(text).not.toMatch(/#003B71|#00C1DE|#F7FAFC|#333333|Inter\|/i)
      expect(text).not.toContain('{{')
    }
    expect(wxr).toContain('#7A1F3D')
    expect(wxr).toContain(gcidFor('action'))
    expect(JSON.parse(lib).global_colors).toContainEqual([gcidFor('primary'), { color: '#7A1F3D', active: 'yes' }])
    expect(strFromU8(files['README.txt'])).toContain('Styling (do this FIRST)')
  }, 60_000)
})
