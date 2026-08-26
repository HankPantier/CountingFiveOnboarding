// Compose the final iframe document for the Theme Studio preview by injecting
// the pending draft theme.css + design-overrides.css into the real-site shell
// (see build-preview-shell.ts). Pure + client-safe (no server imports) so the
// preview re-skins instantly on the client when the sources change.

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

// Map the chosen fonts onto the template's --font-*-loaded vars + a <link> that
// loads the families into the frame, so a font swap re-skins the preview
// instantly (the frame allows external CSS/fonts even while fully sandboxed).
// Per-field fallbacks handle a partial typography (e.g. no accentFont) — the
// route normalizes on read, this is defense-in-depth.
function fontHead(typography: Partial<PreviewTypography> | undefined): { link: string; vars: string } {
  if (!typography) return { link: '', vars: DEFAULT_FONT_VARS }
  const { headingFont, bodyFont, accentFont, googleFontsUrl } = typography
  const link = googleFontsUrl ? `<link rel="stylesheet" href="${attrSafe(googleFontsUrl)}">` : ''
  const vars =
    `:root{` +
    `--font-heading-loaded:"${attrSafe(headingFont || 'Public Sans')}",system-ui,sans-serif;` +
    `--font-body-loaded:"${attrSafe(bodyFont || 'Public Sans')}",system-ui,sans-serif;` +
    `--font-accent-loaded:"${attrSafe(accentFont || 'Fraunces')}",Georgia,"Times New Roman",serif;}`
  return { link, vars }
}

export function composePreviewSrcDoc(args: {
  shellHtml: string
  themeCss: string
  overridesCss: string
  typography?: PreviewTypography
}): string {
  const { link, vars } = fontHead(args.typography)
  const style = `${link}<style>${vars}\n${cssSafe(args.themeCss)}\n${cssSafe(args.overridesCss)}</style>`
  const { shellHtml } = args
  return shellHtml.includes(THEME_SLOT)
    ? shellHtml.replace(THEME_SLOT, style)
    : shellHtml.replace(/<\/head>/i, `${style}</head>`)
}
