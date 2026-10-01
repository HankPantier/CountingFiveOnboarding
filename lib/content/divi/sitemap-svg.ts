// Standalone SVG schematic of the sitemap (Divi export bridge — see ./README.md).
// Draws the shared layout from ./sitemap-layout; ./sitemap-png rasterizes it.

import type { BoxVariant, LayoutBox, SitemapLayout, SitemapTheme } from './sitemap-layout'

export const SITEMAP_FONT_FAMILY = 'Open Sans'

export type BoxStyle = {
  fill: string
  stroke: string
  dashed: boolean
  radius: number
  title: string
  sub: string
  subOpacity: number
}

export function boxStyle(variant: BoxVariant, t: SitemapTheme): BoxStyle {
  switch (variant) {
    case 'home':
    case 'top':
      return { fill: t.primary, stroke: t.primary, dashed: false, radius: 8, title: '#FFFFFF', sub: '#FFFFFF', subOpacity: 0.8 }
    case 'link':
      return { fill: t.paper, stroke: t.muted, dashed: false, radius: 23, title: t.ink, sub: t.muted, subOpacity: 1 }
    case 'loose':
      return { fill: t.soft, stroke: t.line, dashed: true, radius: 8, title: t.ink, sub: t.muted, subOpacity: 1 }
    default:
      return { fill: t.paper, stroke: t.primary, dashed: false, radius: 8, title: t.ink, sub: t.muted, subOpacity: 1 }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function boxSvg(b: LayoutBox, t: SitemapTheme): string {
  const s = boxStyle(b.variant, t)
  const dash = s.dashed ? ' stroke-dasharray="5 4"' : ''
  const tag = b.tag
    ? `<text x="${b.x + b.w - 10}" y="${b.y + 18}" font-size="8.5" text-anchor="end" fill="${s.sub}" fill-opacity="${s.subOpacity}">${esc(b.tag)}</text>`
    : ''
  return (
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${s.radius}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.25"${dash}/>` +
    `<text x="${b.x + 10}" y="${b.y + 19}" font-size="12.5" font-weight="700" fill="${s.title}">${esc(b.title)}</text>` +
    `<text x="${b.x + 10}" y="${b.y + 35}" font-size="9.5" fill="${s.sub}" fill-opacity="${s.subOpacity}">${esc(b.sub)}</text>` +
    tag
  )
}

export function renderSitemapSvg(layout: SitemapLayout, t: SitemapTheme): string {
  const lines = layout.lines
    .map(
      (l) =>
        `<polyline points="${l.points.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" stroke="${t.line}" stroke-width="1.5"${l.dashed ? ' stroke-dasharray="5 4"' : ''}/>`
    )
    .join('')
  const groups = layout.groups
    .map(
      (g) =>
        `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="12" fill="none" stroke="${t.line}" stroke-width="1.5" stroke-dasharray="6 5"/>`
    )
    .join('')
  const texts = layout.texts
    .map(
      (x) =>
        `<text x="${x.x}" y="${x.y}" font-size="${x.size}"${x.bold ? ' font-weight="700"' : ''} fill="${x.muted ? t.muted : t.ink}">${esc(x.text)}</text>`
    )
    .join('')
  const boxes = layout.boxes.map((b) => boxSvg(b, t)).join('')
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" ` +
    `font-family="'${SITEMAP_FONT_FAMILY}', 'Segoe UI', system-ui, -apple-system, sans-serif">` +
    `<rect width="100%" height="100%" fill="${t.paper}"/>` +
    groups +
    lines +
    texts +
    boxes +
    `</svg>\n`
  )
}
