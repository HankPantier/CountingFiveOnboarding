// PNG raster of the sitemap schematic (Divi export bridge — see ./README.md).
//
// resvg with the bundled Open Sans rather than sharp/librsvg: Vercel functions
// ship no system fonts, so librsvg would render every label blank. The font
// files are force-traced for the export route in next.config.ts. Fail-soft: a
// missing native binding or font returns null and the export ships without it.

import path from 'node:path'
import { SITEMAP_FONT_FAMILY } from './sitemap-svg'

const FONT_DIR = path.join(process.cwd(), 'lib/content/divi/assets')
const MAX_PX = 4000

export async function renderSitemapPng(svg: string, width: number): Promise<Buffer | null> {
  try {
    const { renderAsync } = await import('@resvg/resvg-js')
    const image = await renderAsync(svg, {
      fitTo: { mode: 'zoom', value: Math.min(2, MAX_PX / Math.max(width, 1)) },
      background: '#FFFFFF',
      font: {
        loadSystemFonts: false,
        fontFiles: [path.join(FONT_DIR, 'OpenSans-Regular.ttf'), path.join(FONT_DIR, 'OpenSans-Bold.ttf')],
        defaultFontFamily: SITEMAP_FONT_FAMILY,
        sansSerifFamily: SITEMAP_FONT_FAMILY,
      },
    })
    return image.asPng()
  } catch (err) {
    console.warn('[divi-export] sitemap PNG render skipped:', err instanceof Error ? err.message : err)
    return null
  }
}
