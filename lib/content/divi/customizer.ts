// ---------------------------------------------------------------------------
// Divi Theme Customizer import file (Divi export bridge — see ./README.md).
//
// Divi's Customizer import is NOT a merge: it resets every Customizer setting
// in the `et_divi` option (all but the Theme Options panel keys) and replaces
// them with the file's, and `wp_custom_css` overwrites Additional CSS
// (core/components/Portability.php → import(), 'options' type). So the file is
// the boilerplate's full Customizer export (__fixtures__/divi-customizer-base.json,
// exported from the boilerplate site) with only our styling keys changed, and
// our CSS appended after the boilerplate's own Additional CSS.
//
// Refreshing the base: when the boilerplate's Customizer settings change,
// re-export them (Divi → Theme Customizer → portability icon → Export) and
// replace the fixture file.
// ---------------------------------------------------------------------------

import baseExport from './__fixtures__/divi-customizer-base.json'
import { brandCss, BRAND_CSS_END, BRAND_CSS_START, gcidFor, googleFontsImport, PALETTE_ROLES, TYPE_SCALE, type DiviStyle } from './style'

type CustomizerValue = string | number | boolean | null | CustomizerValue[] | { [key: string]: CustomizerValue }
export type CustomizerExport = {
  context: string
  data: Record<string, CustomizerValue>
  presets: CustomizerValue
  global_colors: CustomizerValue
  images: CustomizerValue[]
  thumbnails: CustomizerValue[]
}

export const CUSTOMIZER_BASE = baseExport as unknown as CustomizerExport

// Drop a previous export's brand block (and its font @import) so re-importing
// over an already-styled site never stacks two copies.
export function stripBrandCss(css: string): string {
  const start = css.indexOf(BRAND_CSS_START)
  let out = css
  if (start !== -1) {
    const end = css.indexOf(BRAND_CSS_END, start)
    out = css.slice(0, start) + (end === -1 ? '' : css.slice(end + BRAND_CSS_END.length))
  }
  return out.replace(/^(?:@import url\("https:\/\/fonts\.googleapis\.com\/[^"]*"\);\s*)+/, '').trim()
}

// Additional CSS = font @import (must lead the stylesheet) + the boilerplate's
// CSS untouched + our brand block last, so it wins over the boilerplate's
// typography at equal specificity.
export function composeCustomCss(baseCss: string, style: DiviStyle): string {
  const imp = googleFontsImport(style)
  return [imp, stripBrandCss(baseCss), brandCss(style)].filter(Boolean).join('\n\n') + '\n'
}

// The styling keys this export owns. Everything else in the base is preserved
// byte-for-byte.
export function styleOverrides(style: DiviStyle): Record<string, CustomizerValue> {
  const p = style.palette
  const d = style.derived
  const radiusPx = style.radius.button.replace(/px$/, '')
  const sizes: Record<string, CustomizerValue> = {}
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
    const t = TYPE_SCALE[tag]
    sizes[`pac_drh_${tag}_desktop`] = `${t.px.desktop}px`
    sizes[`pac_drh_${tag}_tablet`] = `${t.px.tablet}px`
    sizes[`pac_drh_${tag}_phone`] = `${t.px.phone}px`
    sizes[`pac_drh_${tag}_line_height`] = `${t.lineHeight}em`
  }
  const globalColors: Record<string, CustomizerValue> = {}
  for (const role of PALETTE_ROLES) globalColors[gcidFor(role)] = { color: p[role], active: 'yes' }

  return {
    // Typography
    heading_font: style.fonts.heading,
    body_font: style.fonts.body,
    heading_font_weight: '700',
    body_font_weight: '400',
    body_font_size: String(TYPE_SCALE.body.px),
    tablet_body_font_size: String(TYPE_SCALE.body.px),
    phone_body_font_size: String(TYPE_SCALE.body.px),
    body_font_height: TYPE_SCALE.body.lineHeight,
    body_header_size: String(TYPE_SCALE.h1.px.desktop),
    tablet_header_font_size: String(TYPE_SCALE.h1.px.tablet),
    phone_header_font_size: String(TYPE_SCALE.h1.px.phone),
    body_header_height: TYPE_SCALE.h1.lineHeight,
    body_header_spacing: '0',
    body_header_style: '',
    // Divi Responsive Helper: per-device H1–H6 sizes from the template scale.
    pac_drh_enable_text_sizes: 'on',
    ...sizes,
    pac_drh_p_desktop: `${TYPE_SCALE.body.px}px`,
    pac_drh_p_tablet: `${TYPE_SCALE.body.px}px`,
    pac_drh_p_phone: `${TYPE_SCALE.body.px}px`,
    pac_drh_p_line_height: `${TYPE_SCALE.body.lineHeight}em`,
    // Colours
    accent_color: p.primary,
    secondary_accent_color: p.secondary,
    header_color: d.heading,
    font_color: d.text,
    link_color: d.actionText,
    menu_link: d.text,
    menu_link_active: d.actionText,
    mobile_menu_link: d.text,
    fixed_menu_link: d.text,
    fixed_menu_link_active: d.actionText,
    primary_nav_font: style.fonts.heading,
    footer_bg: p.nearBlack,
    // Buttons
    all_buttons_font: style.fonts.heading,
    all_buttons_font_size: '16',
    all_buttons_font_style: '',
    all_buttons_spacing: '0',
    all_buttons_text_color: d.onAction,
    all_buttons_bg_color: p.action,
    all_buttons_border_width: '0',
    all_buttons_border_color: p.action,
    all_buttons_border_radius: radiusPx,
    all_buttons_icon: 'no',
    all_buttons_text_color_hover: d.onAction,
    all_buttons_bg_color_hover: p.action,
    all_buttons_border_color_hover: p.action,
    all_buttons_border_radius_hover: radiusPx,
    all_buttons_spacing_hover: '0',
    // Palette
    et_global_colors: globalColors,
  }
}

export function buildDiviCustomizer(style: DiviStyle, base: CustomizerExport = CUSTOMIZER_BASE): string {
  const baseCss = typeof base.data.wp_custom_css === 'string' ? base.data.wp_custom_css : ''
  const data: Record<string, CustomizerValue> = {
    ...base.data,
    ...styleOverrides(style),
    wp_custom_css: composeCustomCss(baseCss, style),
  }
  return JSON.stringify({ ...base, data })
}
