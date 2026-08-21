// ---------------------------------------------------------------------------
// Block parsing + Divi shortcode rendering.
//
// Part of the throwaway Divi/WordPress export bridge (see ./README.md). Turns a
// generated page's block-annotated markdown body into Divi Builder shortcode by
// lifting the styled "BP -" boilerplate layout shells from the reference export
// (raw-docs/Divi Builder Layouts.json) and substituting real copy.
//
// Design notes:
//  - Every block family that lacks a dedicated template falls back to a plain
//    styled text block (basicContentBlock) so no content is ever dropped.
//  - Card icons and testimonial author/quote parsing are intentionally omitted
//    from v1 (an open item in the design doc) — wrong icons read worse than
//    none. Cards render as clean title + body blurbs.
// ---------------------------------------------------------------------------

import { markdownToHtml, inlineMarkdown } from './markdown'

const BV = '4.27.4' // Divi _builder_version stamped on emitted modules

// Divi encodes a literal double-quote inside a shortcode attribute as %22.
function attr(value: string): string {
  return (value ?? '').replace(/"/g, '%22').replace(/\r?\n/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type DiviSection = {
  blockId: string
  variant?: string
  image?: string
  alt?: string
  query?: string
  heading: string
  content: string
}

// Mirror of the validator's SECTION_PATTERN, widened to also capture the alt +
// query attributes (kept local so this bridge stays deletable in one folder).
const SECTION_PATTERN =
  /<!-- block: ([a-z-]+)(?:\s*\|\s*variant:\s*([a-z0-9-]+))?(?:\s*\|\s*image:\s*([^\s|>]+))?(?:\s*\|\s*alt:\s*"([^"]*)")?(?:\s*\|\s*query:\s*"([^"]*)")?\s*-->\s*\n##\s+(.+?)\n([\s\S]*?)(?=\n<!-- block:|$)/g

export function parseDiviSections(body: string): DiviSection[] {
  const out: DiviSection[] = []
  SECTION_PATTERN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SECTION_PATTERN.exec(body ?? '')) !== null) {
    out.push({
      blockId: m[1],
      variant: m[2] || undefined,
      image: m[3] || undefined,
      alt: m[4] || undefined,
      query: m[5] || undefined,
      heading: m[6].trim(),
      content: m[7] ?? '',
    })
  }
  return out
}

export type Card = { title: string; bodyHtml: string }

// Split a card-grid section body into `### Title` (or `**Title**`) items. Lines
// like `icon:`/`photo:` are dropped by markdownToHtml. Returns [] when the body
// isn't card-shaped, letting the renderer fall back to prose.
export function parseCards(content: string): Card[] {
  const parts = content.split(/\n(?=###\s+)/)
  const cards: Card[] = []
  for (const part of parts) {
    const m = part.match(/^###\s+(.+?)\n([\s\S]*)$/)
    if (!m) continue
    cards.push({ title: m[1].trim(), bodyHtml: markdownToHtml(m[2]) })
  }
  return cards
}

export type QA = { question: string; answer: string }

// Extract **Q: …** / A: … pairs from an inline faq-accordion section body.
export function parseQA(content: string): QA[] {
  const out: QA[] = []
  const re = /\*\*Q:\s*(.+?)\*\*\s*\n\s*A:\s*([\s\S]*?)(?=\n\s*\*\*Q:|\s*$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    out.push({ question: m[1].trim(), answer: m[2].trim() })
  }
  return out
}

// ---------------------------------------------------------------------------
// Shortcode template shells (lifted from the reference boilerplate export)
// ---------------------------------------------------------------------------

export function basicContentBlock(html: string): string {
  return (
    `[et_pb_section fb_built="1" _builder_version="${BV}" _module_preset="default" custom_padding="||60px|||" global_colors_info="{}" template_type="section"]` +
    `[et_pb_row _builder_version="${BV}" _module_preset="default" width="100%" max_width="75%" module_alignment="center" global_colors_info="{}"]` +
    `[et_pb_column type="4_4" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]` +
    `[et_pb_text _builder_version="${BV}" text_font="||||||||" text_text_color="#333333" text_font_size="18px" text_line_height="1.8em" header_2_font="|800|||||||" header_2_text_color="#003B71" header_2_font_size="34px" header_3_font="|700|||||||" header_3_text_color="#003B71" header_3_font_size="24px" global_colors_info="{}"]` +
    `${html}` +
    `[/et_pb_text][/et_pb_column][/et_pb_row][/et_pb_section]`
  )
}

export function subPageHeader(title: string, subhead?: string): string {
  const sub = subhead
    ? `\n<p style="color:#EEEEEE;font-size:18px;">${inlineMarkdown(subhead)}</p>`
    : ''
  return (
    `[et_pb_section fb_built="1" _builder_version="${BV}" _module_preset="default" background_color="#003B71" custom_padding="70px||70px|||" global_colors_info="{}" template_type="section"]` +
    `[et_pb_row _builder_version="${BV}" _module_preset="default" width="100%" max_width="75%" module_alignment="center" global_colors_info="{}"]` +
    `[et_pb_column type="4_4" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]` +
    `[et_pb_text _builder_version="${BV}" text_orientation="center" background_layout="dark" header_font="Inter|800|||||||" header_text_color="#FFFFFF" header_font_size="42px" global_colors_info="{}"]` +
    `<h1>${inlineMarkdown(title)}</h1>${sub}` +
    `[/et_pb_text][/et_pb_column][/et_pb_row][/et_pb_section]`
  )
}

function imageColumn(url: string, alt: string): string {
  return (
    `[et_pb_column type="1_2" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]` +
    `[et_pb_image src="${attr(url)}" alt="${attr(alt)}" _builder_version="${BV}" _module_preset="default" border_radii="on|12px|12px|12px|12px" box_shadow_style="preset3" box_shadow_color="rgba(0,59,113,0.15)" global_colors_info="{}"][/et_pb_image]` +
    `[/et_pb_column]`
  )
}

// content-split (light) and hero/hero-split (gradient) share this two-column
// copy+image shell; `hero` swaps in the gradient background + H1.
export function copyImageBlock(opts: {
  heading: string
  subhead?: string
  bodyHtml: string
  buttonText?: string
  buttonUrl?: string
  imageUrl?: string
  imageAlt?: string
  side: 'image-right' | 'image-left'
  hero?: boolean
}): string {
  const headingTag = opts.hero ? 'h1' : 'h2'
  const sub = opts.subhead
    ? `\n<h2>${inlineMarkdown(opts.subhead)}</h2>`
    : ''
  const button =
    opts.buttonText && opts.buttonUrl
      ? `[et_pb_button button_url="${attr(opts.buttonUrl)}" button_text="${attr(opts.buttonText)}" button_alignment="left" _builder_version="${BV}" _module_preset="default" custom_button="on" button_text_size="15px" button_text_color="${opts.hero ? '#003B71' : '#FFFFFF'}" button_bg_color="${opts.hero ? '#FFFFFF' : '#00C1DE'}" button_border_width="0px" button_border_radius="40px" button_font="--et_global_heading_font|700||on|||||" custom_padding="15px|25px|15px|25px|true|true" global_colors_info="{}"][/et_pb_button]`
      : ''

  const textColor = opts.hero ? '#FFFFFF' : '#333333'
  const headerColor = opts.hero ? '#FFFFFF' : '#003B71'
  const textColumn =
    `[et_pb_column type="1_2" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]` +
    `[et_pb_text _builder_version="${BV}" ${opts.hero ? 'background_layout="dark" ' : ''}header_font="Inter|800|||||||" header_text_color="${headerColor}" header_font_size="${opts.hero ? '44px' : '34px'}" header_2_font="Inter||||||||" header_2_text_color="${opts.hero ? '#EEEEEE' : '#00C1DE'}" header_2_font_size="22px" text_font="Inter||||||||" text_text_color="${textColor}" text_font_size="17px" text_line_height="1.9em" global_colors_info="{}"]` +
    `<${headingTag}>${inlineMarkdown(opts.heading)}</${headingTag}>${sub}\n${opts.bodyHtml}` +
    `[/et_pb_text]${button}[/et_pb_column]`

  const imgCol = opts.imageUrl ? imageColumn(opts.imageUrl, opts.imageAlt ?? opts.heading) : ''
  const cols = imgCol
    ? opts.side === 'image-left'
      ? imgCol + textColumn
      : textColumn + imgCol
    : textColumn

  const sectionAttrs = opts.hero
    ? `background_color="#003B71" use_background_color_gradient="on" background_color_gradient_stops="#003b71 0%|#00C1DE 100%" background_color_gradient_start="#003b71" background_color_gradient_end="#00C1DE" custom_padding="90px|0px|90px|0px"`
    : `custom_padding="50px|0px|50px|0px"`

  return (
    `[et_pb_section fb_built="1" _builder_version="${BV}" _module_preset="default" ${sectionAttrs} global_colors_info="{}" template_type="section"]` +
    `[et_pb_row column_structure="1_2,1_2" _builder_version="${BV}" _module_preset="default" width="100%" max_width="75%" module_alignment="center" make_equal="on" global_colors_info="{}"]` +
    `${cols}` +
    `[/et_pb_row][/et_pb_section]`
  )
}

function cardColumn(card: Card, colType: string): string {
  return (
    `[et_pb_column type="${colType}" _builder_version="${BV}" _module_preset="default" background_color="#FFFFFF" custom_padding="24px|24px|24px|24px|true|false" border_radii="on|8px|8px|8px|8px" box_shadow_style="preset3" box_shadow_color="rgba(0,59,113,0.15)" global_colors_info="{}"]` +
    `[et_pb_text _builder_version="${BV}" _module_preset="default" header_3_font="|800|||||||" header_3_text_color="#003B71" header_3_font_size="20px" text_font="||||||||" text_text_color="#333333" text_font_size="15px" text_line_height="1.7em" global_colors_info="{}"]` +
    `<h3>${inlineMarkdown(card.title)}</h3>\n${card.bodyHtml}` +
    `[/et_pb_text][/et_pb_column]`
  )
}

const COL_TYPES: Record<number, string> = { 1: '4_4', 2: '1_2', 3: '1_3', 4: '1_4' }

export function cardGridBlock(heading: string, cards: Card[], cols: number): string {
  const perRow = Math.min(Math.max(cols, 1), 4)
  const rows: string[] = []
  const headingText = heading
    ? `[et_pb_row _builder_version="${BV}" _module_preset="default" width="100%" max_width="75%" module_alignment="center" global_colors_info="{}"]` +
      `[et_pb_column type="4_4" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]` +
      `[et_pb_text _builder_version="${BV}" text_orientation="center" header_2_font="|800|||||||" header_2_text_color="#003B71" header_2_font_size="34px" global_colors_info="{}"]<h2>${inlineMarkdown(heading)}</h2>[/et_pb_text]` +
      `[/et_pb_column][/et_pb_row]`
    : ''

  for (let i = 0; i < cards.length; i += perRow) {
    const chunk = cards.slice(i, i + perRow)
    const colType = COL_TYPES[chunk.length] ?? '1_3'
    const structure = chunk.map(() => colType).join(',')
    rows.push(
      `[et_pb_row column_structure="${structure}" use_custom_gutter="on" gutter_width="2" make_equal="on" _builder_version="${BV}" _module_preset="default" width="100%" max_width="75%" module_alignment="center" global_colors_info="{}"]` +
        chunk.map((c) => cardColumn(c, colType)).join('') +
        `[/et_pb_row]`
    )
  }

  return (
    `[et_pb_section fb_built="1" _builder_version="${BV}" _module_preset="default" background_color="#F7FAFC" custom_padding="50px||60px|||" global_colors_info="{}" template_type="section"]` +
    `${headingText}${rows.join('')}` +
    `[/et_pb_section]`
  )
}

export function ctaBlock(opts: {
  heading: string
  bodyHtml: string
  buttonText: string
  buttonUrl: string
}): string {
  return (
    `[et_pb_section fb_built="1" _builder_version="${BV}" _module_preset="default" background_color="#003B71" custom_padding="60px|0px|60px|0px|true|true" global_colors_info="{}" template_type="section"]` +
    `[et_pb_row column_structure="2_3,1_3" use_custom_gutter="on" make_equal="on" _builder_version="${BV}" _module_preset="default" width="100%" max_width="75%" module_alignment="center" global_colors_info="{}"]` +
    `[et_pb_column type="2_3" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]` +
    `[et_pb_text _builder_version="${BV}" background_layout="dark" header_2_font="|700|||||||" header_2_text_color="#FFFFFF" header_2_font_size="34px" text_text_color="#EEEEEE" text_font_size="17px" global_colors_info="{}"]` +
    `<h2>${inlineMarkdown(opts.heading)}</h2>\n${opts.bodyHtml}` +
    `[/et_pb_text][/et_pb_column]` +
    `[et_pb_column type="1_3" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]` +
    `[et_pb_button button_url="${attr(opts.buttonUrl)}" button_text="${attr(opts.buttonText)}" button_alignment="center" _builder_version="${BV}" _module_preset="default" custom_button="on" button_text_size="16px" button_text_color="#003B71" button_bg_color="#00C1DE" button_border_width="0px" button_border_radius="40px" button_font="--et_global_heading_font|700||on|||||" custom_padding="16px|30px|16px|30px|true|true" box_shadow_style="preset3" box_shadow_color="rgba(0,193,222,0.35)" global_colors_info="{}"][/et_pb_button]` +
    `[/et_pb_column][/et_pb_row][/et_pb_section]`
  )
}

export function accordionBlock(heading: string, items: QA[]): string {
  const accItems = items
    .map(
      (qa, i) =>
        `[et_pb_accordion_item title="${attr(qa.question)}" _builder_version="${BV}" _module_preset="default" open="${i === 0 ? 'on' : 'off'}" global_colors_info="{}"]${markdownToHtml(qa.answer)}[/et_pb_accordion_item]`
    )
    .join('')
  const headingText = heading
    ? `[et_pb_text _builder_version="${BV}" header_2_font="|700|||||||" header_2_text_color="#003B71" header_2_font_size="34px" custom_margin="||20px|" global_colors_info="{}"]<h2>${inlineMarkdown(heading)}</h2>[/et_pb_text]`
    : ''
  return (
    `[et_pb_section fb_built="1" _builder_version="${BV}" _module_preset="default" background_color="#EEEEEE" custom_padding="50px|0px|50px|0px|true|true" global_colors_info="{}" template_type="section"]` +
    `[et_pb_row _builder_version="${BV}" _module_preset="default" width="100%" max_width="75%" module_alignment="center" global_colors_info="{}"]` +
    `[et_pb_column type="4_4" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]` +
    `${headingText}` +
    `[et_pb_accordion _builder_version="${BV}" _module_preset="default" toggle_font="|700|||||||" toggle_text_color="#003B71" body_font="||||||||" body_text_color="#333333" global_colors_info="{}"]${accItems}[/et_pb_accordion]` +
    `[/et_pb_column][/et_pb_row][/et_pb_section]`
  )
}
