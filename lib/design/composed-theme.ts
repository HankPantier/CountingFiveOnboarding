// Pure + client-safe. The theme a composed preview document needs (theme.css,
// the overrides, fonts, <html> treatment attributes), derived from rendered
// repo files. Shared by the server renderer (concept + current-site folds) and
// the ViewportToggle iframe (via the concept preview route) so both show the
// exact same thing.
import type { DesignJson } from '@/types/design-json'
import { normalizeTypography } from '@/app/api/edit/[id]/theme/_theme'
import { composePreviewSrcDoc } from '@/lib/theme-preview/compose-srcdoc'

export type ComposedTheme = {
  themeCss: string
  overridesCss: string
  typography: { headingFont: string; bodyFont: string; accentFont: string; googleFontsUrl: string }
  htmlAttributes: Record<string, string | null>
}

export function composedThemeFromFiles(files: { designText: string; themeCss: string; overridesCss: string }): ComposedTheme {
  let design: Partial<DesignJson> = {}
  try {
    const parsed: unknown = JSON.parse(files.designText)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) design = parsed as Partial<DesignJson>
  } catch {
    design = {}
  }
  return {
    themeCss: files.themeCss,
    overridesCss: files.overridesCss,
    typography: normalizeTypography(design.typography),
    htmlAttributes: {
      'data-headline': design.headlineStyle ?? 'sans',
      'data-eyebrow': design.eyebrowStyle ?? 'standard',
    },
  }
}

export function composeThemeDoc(shellHtml: string, theme: ComposedTheme): string {
  return composePreviewSrcDoc({
    shellHtml,
    themeCss: theme.themeCss,
    overridesCss: theme.overridesCss,
    typography: theme.typography,
    htmlAttributes: theme.htmlAttributes,
  })
}
