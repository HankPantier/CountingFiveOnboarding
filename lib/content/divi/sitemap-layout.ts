// ---------------------------------------------------------------------------
// Schematic layout for the sitemap (Divi export bridge — see ./README.md).
//
// Pure geometry, computed once and drawn by both the standalone SVG renderer
// and the PDF's vector page: Home on top, one column per top-level menu item
// with its children stacked (and indented) beneath, and a dashed "Not in
// navigation" group along the bottom.
// ---------------------------------------------------------------------------

import type { SitemapModel, SitemapNode } from './sitemap'

export type BoxVariant = 'home' | 'top' | 'page' | 'link' | 'loose'

export type LayoutBox = {
  x: number
  y: number
  w: number
  h: number
  title: string
  sub: string
  variant: BoxVariant
  tag: string | null // e.g. "auto-created" for synthesized landing pages
}

export type LayoutText = { x: number; y: number; text: string; size: number; bold: boolean; muted: boolean }
export type LayoutLine = { points: Array<[number, number]>; dashed: boolean }
export type LayoutRect = { x: number; y: number; w: number; h: number }

export type SitemapLayout = {
  width: number
  height: number
  boxes: LayoutBox[]
  lines: LayoutLine[]
  texts: LayoutText[]
  groups: LayoutRect[] // dashed group outlines
}

export const BOX_W = 210
export const BOX_H = 46
const M = 32
const COL_GAP = 22
const ROW_GAP = 12
const INDENT = 18
const TITLE_SIZE = 12.5
const SUB_SIZE = 9.5

// Open Sans averages ~0.55em per glyph (bold a touch wider); good enough to keep
// labels inside their boxes without measuring.
export function fitText(text: string, maxWidth: number, size: number, bold = false): string {
  const per = size * (bold ? 0.6 : 0.55)
  const max = Math.max(4, Math.floor(maxWidth / per))
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…'
}

const TAGS: Partial<Record<SitemapNode['kind'], string>> = {
  'synthesized-section': 'auto-created',
  'synthesized-home': 'auto-created',
  'custom-link': 'link',
}

function boxFor(node: SitemapNode, x: number, y: number, w: number, variant: BoxVariant): LayoutBox {
  const where = node.kind === 'custom-link' ? node.path : node.wpUrl
  const sub = node.menuPosition ? `${node.menuPosition} · ${where}` : where
  const tag = TAGS[node.kind] ?? null
  const titleRoom = w - 20 - (tag ? tag.length * 6 + 10 : 0)
  return {
    x,
    y,
    w,
    h: BOX_H,
    title: fitText(node.title, titleRoom, TITLE_SIZE, true),
    sub: fitText(sub, w - 20, SUB_SIZE),
    variant,
    tag,
  }
}

export function layoutSitemap(model: SitemapModel): SitemapLayout {
  const boxes: LayoutBox[] = []
  const lines: LayoutLine[] = []
  const texts: LayoutText[] = []
  const groups: LayoutRect[] = []

  const cols = Math.max(model.menu.length, 4)
  const innerW = cols * (BOX_W + COL_GAP) - COL_GAP
  const width = innerW + M * 2

  texts.push({ x: M, y: M + 4, text: `${model.firmName} — site map`, size: 18, bold: true, muted: false })
  texts.push({
    x: M,
    y: M + 24,
    text: 'Columns = Primary Menu (left to right). Indented = dropdown children. Dashed = not in any menu.',
    size: 10,
    bold: false,
    muted: true,
  })

  // Home, centred over the menu columns; header CTA button beside it.
  const homeY = M + 48
  const homeX = M + (innerW - BOX_W) / 2
  boxes.push(boxFor(model.home, homeX, homeY, BOX_W, 'home'))
  if (model.cta) {
    const ctaX = homeX + BOX_W + 28
    boxes.push({
      x: ctaX,
      y: homeY,
      w: 170,
      h: BOX_H,
      title: fitText(model.cta.label, 150, TITLE_SIZE, true),
      sub: fitText(`header button · ${model.cta.url}`, 150, SUB_SIZE),
      variant: 'link',
      tag: null,
    })
  }

  const busY = homeY + BOX_H + 22
  const colTop = busY + 22
  let menuBottom = colTop

  if (model.menu.length === 0) {
    texts.push({
      x: M,
      y: colTop + 16,
      text: 'No navigation configured — every page imports without a menu entry. Build the Primary Menu by hand.',
      size: 11,
      bold: true,
      muted: false,
    })
    menuBottom = colTop + 28
  } else {
    const centres = model.menu.map((_, i) => M + i * (BOX_W + COL_GAP) + BOX_W / 2)
    lines.push({ points: [[homeX + BOX_W / 2, homeY + BOX_H], [homeX + BOX_W / 2, busY]], dashed: false })
    lines.push({ points: [[Math.min(centres[0], homeX + BOX_W / 2), busY], [Math.max(centres[centres.length - 1], homeX + BOX_W / 2), busY]], dashed: false })

    model.menu.forEach((top, i) => {
      const colX = M + i * (BOX_W + COL_GAP)
      lines.push({ points: [[centres[i], busY], [centres[i], colTop]], dashed: false })
      boxes.push(boxFor(top, colX, colTop, BOX_W, top.kind === 'custom-link' ? 'link' : 'top'))
      let cursor = colTop + BOX_H + ROW_GAP

      const placeChildren = (parent: SitemapNode, parentX: number, parentBottom: number, depth: number) => {
        const spineX = parentX + 10
        for (const child of parent.children) {
          const x = colX + depth * INDENT
          const y = cursor
          boxes.push(boxFor(child, x, y, BOX_W - depth * INDENT, child.kind === 'custom-link' ? 'link' : 'page'))
          lines.push({ points: [[spineX, parentBottom], [spineX, y + BOX_H / 2], [x, y + BOX_H / 2]], dashed: false })
          cursor += BOX_H + ROW_GAP
          if (child.children.length) placeChildren(child, x, y + BOX_H, depth + 1)
        }
      }
      placeChildren(top, colX, colTop + BOX_H, 1)
      menuBottom = Math.max(menuBottom, cursor - ROW_GAP)
    })
  }

  let height = menuBottom + M
  if (model.notInNav.length) {
    const groupY = menuBottom + 36
    texts.push({
      x: M,
      y: groupY + 22,
      text: `Not in navigation (${model.notInNav.length}) — imported as pages, not assigned to any menu`,
      size: 11,
      bold: true,
      muted: true,
    })
    const rowsStart = groupY + 36
    model.notInNav.forEach((node, i) => {
      const r = Math.floor(i / cols)
      const c = i % cols
      boxes.push(boxFor(node, M + c * (BOX_W + COL_GAP), rowsStart + r * (BOX_H + ROW_GAP), BOX_W, 'loose'))
    })
    const rows = Math.ceil(model.notInNav.length / cols)
    const groupBottom = rowsStart + rows * (BOX_H + ROW_GAP) - ROW_GAP + 14
    groups.push({ x: M - 12, y: groupY, w: innerW + 24, h: groupBottom - groupY })
    height = groupBottom + M
  }

  const right = Math.max(width, ...boxes.map((b) => b.x + b.w + M))
  return { width: right, height, boxes, lines, texts, groups }
}

export type SitemapTheme = { primary: string; ink: string; muted: string; line: string; soft: string; paper: string }

const HEX = /^#[0-9a-f]{6}$/i

export function sitemapTheme(palette: { primary?: string; nearBlack?: string } | null | undefined): SitemapTheme {
  const primary = palette?.primary && HEX.test(palette.primary) ? palette.primary : '#231F20'
  const ink = palette?.nearBlack && HEX.test(palette.nearBlack) ? palette.nearBlack : '#1E293B'
  return { primary, ink, muted: '#64748B', line: '#CBD5E1', soft: '#F1F5F9', paper: '#FFFFFF' }
}
