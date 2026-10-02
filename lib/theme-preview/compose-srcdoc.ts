// Compose the final iframe document for the Theme Studio preview by injecting
// the pending draft theme.css + design-overrides.css into the real-site shell
// (see build-preview-shell.ts). Pure + client-safe (no server imports) so the
// preview re-skins instantly on the client when the sources change.
import { STYLE_AXIS_ATTRIBUTES } from '@/lib/design/style-axes'
import { LOGO_SIZE_ATTRIBUTE, LOGO_TONE_ATTRIBUTE } from '@/lib/design/logo-size'
import { LAYOUT_PRESET_ATTRIBUTES } from '@/lib/design/layout-presets'

// The marker the shell leaves at the end of <head> for the injected theme.
export const THEME_SLOT = '<!--__C5_THEME_SLOT__-->'

// Neutralize a stray `</style>` in injected CSS so it can't break out of the
// <style> element. The frame is already fully sandboxed, but theme.css /
// design-overrides.css can be authored outside our validated tools.
function cssSafe(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1')
}

// Fallback font vars when no typography is supplied — the template's defaults.
const DEFAULT_FONT_VARS = `:root{--font-heading-loaded:"Public Sans",system-ui,sans-serif;--font-body-loaded:"Public Sans",system-ui,sans-serif;--font-accent-loaded:"Fraunces",Georgia,"Times New Roman",serif;}`

type PreviewTypography = {
  headingFont: string
  bodyFont: string
  accentFont: string
  googleFontsUrl: string
}

// Escape a value for a double-quoted HTML attribute (the font URL) / CSS string.
// Coerce first: a legacy design.json can omit a font field, and this must never
// throw on an undefined value (that crashed the whole Theme Studio at mount).
function attrSafe(value: string | undefined): string {
  return (typeof value === 'string' ? value : '').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

// <html> attributes the preview may rewrite. The deployed shell carries the LIVE
// treatment attributes, so the preview has to overwrite them with the pending
// draft values or treatment toggles would never show (same for the P6b style-axis
// data-c5-* attributes, the template 2026.09.8 logo size and the 2026.09.9
// data-c5-layout-* presets). Allowlisted so a
// caller can never add event handlers or other attributes to the frame's root.
export const PREVIEW_HTML_ATTRS: readonly string[] = [
  'data-headline',
  'data-eyebrow',
  ...STYLE_AXIS_ATTRIBUTES,
  LOGO_SIZE_ATTRIBUTE,
  LOGO_TONE_ATTRIBUTE,
  ...LAYOUT_PRESET_ATTRIBUTES,
]

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Set (string) or remove (null) allowlisted attributes on the FIRST <html> tag.
export function setHtmlAttributes(html: string, attrs: Record<string, string | null>): string {
  const match = /<html\b[^>]*>/i.exec(html)
  if (!match) return html
  let tag = match[0]
  for (const [key, value] of Object.entries(attrs)) {
    if (!PREVIEW_HTML_ATTRS.includes(key)) continue
    // Drop any existing occurrence (double-, single- or un-quoted).
    tag = tag.replace(new RegExp(`\\s${key}(=("[^"]*"|'[^']*'|[^\\s>]*))?(?=[\\s>])`, 'i'), '')
    if (value !== null) tag = tag.replace(/>$/, ` ${key}="${escapeAttr(value)}">`)
  }
  return html.slice(0, match.index) + tag + html.slice(match.index + match[0].length)
}

// Map the chosen fonts onto the template's --font-*-loaded vars + a <link> that
// loads the families into the frame, so a font swap re-skins the preview
// instantly (the frame allows external CSS/fonts even while fully sandboxed).
// Per-field fallbacks handle a partial typography (e.g. no accentFont) — the
// route normalizes on read, this is defense-in-depth.
function fontHead(typography: Partial<PreviewTypography> | undefined): { link: string; vars: string } {
  if (!typography) return { link: '', vars: DEFAULT_FONT_VARS }
  const { headingFont, bodyFont, accentFont, googleFontsUrl } = typography
  const link = googleFontsUrl ? `<link rel="stylesheet" href="${attrSafe(googleFontsUrl)}">` : ''
  // !important: the template layout aliases --font-body-loaded (and, T1+, any shared-family role) with an INLINE <html style>, which beats any non-important stylesheet — without it a chosen body font never shows in the preview.
  const vars =
    `:root{` +
    `--font-heading-loaded:"${attrSafe(headingFont || 'Public Sans')}",system-ui,sans-serif !important;` +
    `--font-body-loaded:"${attrSafe(bodyFont || 'Public Sans')}",system-ui,sans-serif !important;` +
    `--font-accent-loaded:"${attrSafe(accentFont || 'Fraunces')}",Georgia,"Times New Roman",serif !important;}`
  return { link, vars }
}

// The draft logo images (data: URLs) to show in place of the deployed ones.
export type PreviewLogos = { primary: string | null; footer: string | null }

const LOGO_ANCHOR_RE = /<a\b[^>]*\bdata-c5="logo"[^>]*>/gi
const FOOTER_RE = /\bdata-component="footer"/i

function setImgSrc(img: string, src: string, footerVariant: boolean | null): string {
  let tag = img
    .replace(/\s(?:srcset|sizes|src)=("[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    .replace(/\s*\/?>$/, ` src="${escapeAttr(src)}">`)
  if (footerVariant !== null) {
    // Mirror the template footer: a footer variant renders as-is, the primary
    // fallback is inverted.
    tag = tag.replace(/\sclass=("[^"]*"|'[^']*')/i, (_m, v: string) => {
      const classes = v.slice(1, -1).split(/\s+/).filter((c) => c && c !== 'invert' && c !== 'opacity-90')
      if (!footerVariant) classes.push('invert', 'opacity-90')
      return ` class="${classes.join(' ')}"`
    })
  }
  return tag
}

// Swap the header + footer logo <img> (the template's [data-c5="logo"] links)
// for the draft files, so a logo upload previews before it is published. A
// link with no <img> (the live site shows the firm name as text) gets one.
export function swapPreviewLogos(html: string, given: PreviewLogos): string {
  // Only inline images: the frame is sandboxed with an opaque origin, so an
  // admin-API URL would load without the session cookie anyway.
  const inline = (u: string | null) => (u && /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(u) ? u : null)
  const logos = { primary: inline(given.primary), footer: inline(given.footer) }
  if (!logos.primary && !logos.footer) return html
  const footerAt = html.search(FOOTER_RE)
  let out = ''
  let last = 0
  for (const m of html.matchAll(LOGO_ANCHOR_RE)) {
    const start = m.index
    const openEnd = start + m[0].length
    const close = html.indexOf('</a>', openEnd)
    if (close < 0) continue
    const inFooter = footerAt >= 0 && start > footerAt
    const src = inFooter ? (logos.footer ?? logos.primary) : logos.primary
    if (!src) continue
    const variant = inFooter ? logos.footer !== null : null
    const inner = html.slice(openEnd, close)
    const img = /<img\b[^>]*>/i.exec(inner)
    const nextInner = img
      ? inner.slice(0, img.index) + setImgSrc(img[0], src, variant) + inner.slice(img.index + img[0].length)
      : setImgSrc('<img alt="" class="h-8 w-auto">', src, variant)
    out += html.slice(last, openEnd) + nextInner
    last = close
  }
  return out + html.slice(last)
}

export function composePreviewSrcDoc(args: {
  shellHtml: string
  themeCss: string
  overridesCss: string
  typography?: PreviewTypography
  htmlAttributes?: Record<string, string | null>
  logos?: PreviewLogos
}): string {
  const { link, vars } = fontHead(args.typography)
  const style = `${link}<style>${vars}\n${cssSafe(args.themeCss)}\n${cssSafe(args.overridesCss)}</style>`
  let shellHtml = args.htmlAttributes ? setHtmlAttributes(args.shellHtml, args.htmlAttributes) : args.shellHtml
  if (args.logos) shellHtml = swapPreviewLogos(shellHtml, args.logos)
  return shellHtml.includes(THEME_SLOT)
    ? shellHtml.replace(THEME_SLOT, style)
    : shellHtml.replace(/<\/head>/i, `${style}</head>`)
}
