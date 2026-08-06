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

// v1 does not swap fonts: alias the template's --font-*-loaded vars to the
// Google-loaded families the shell preconnects, so the real page's var chain
// resolves to the correct type even when next/font's own files don't load
// cross-origin into the frame.
const FONT_VARS = `:root{--font-heading-loaded:"Public Sans",system-ui,sans-serif;--font-body-loaded:"Public Sans",system-ui,sans-serif;--font-accent-loaded:"Fraunces",Georgia,"Times New Roman",serif;}`

export function composePreviewSrcDoc(args: {
  shellHtml: string
  themeCss: string
  overridesCss: string
}): string {
  const style = `<style>${FONT_VARS}\n${cssSafe(args.themeCss)}\n${cssSafe(args.overridesCss)}</style>`
  const { shellHtml } = args
  return shellHtml.includes(THEME_SLOT)
    ? shellHtml.replace(THEME_SLOT, style)
    : shellHtml.replace(/<\/head>/i, `${style}</head>`)
}
