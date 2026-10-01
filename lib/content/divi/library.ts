// ---------------------------------------------------------------------------
// Per-client Header (with Client Center) + Footer as a Divi Library JSON.
// Part of the throwaway Divi/WordPress export bridge (see ./README.md).
//
// Standard WXR can't carry Divi Theme Builder assignments, so the branded
// header/footer ride alongside the .wxr as a Divi Library export the operator
// imports (Divi → Library → Import) and assigns once in Theme Builder. Brand
// colour, logo, nav links, Client Center portals, phone, and social all come
// from the client's own brand/client-center/nav data.
// ---------------------------------------------------------------------------

import type { BrandJson } from '@/types/brand-json'
import type { ClientCenterJson } from '@/types/client-center'
import type { NavJson } from '@/types/nav-json'
import { safeUrl, htmlAttrEscape } from './sanitize'
import { applyDiviStyle, c5, globalColorEntries, HEADING_FONT, radius, type DiviStyle } from './style'

const BV = '4.27.4'

function esc(value: string): string {
  return (value ?? '').replace(/"/g, '%22').replace(/\r?\n/g, ' ').trim()
}

// Encodes &, <, >, and both quote styles — safe for element text and for the
// inside of a double-quoted HTML attribute (portal/social labels are untrusted).
function htmlEsc(value: string): string {
  return htmlAttrEscape(value)
}

// Render a single anchor, or just the escaped label when the URL is unsafe or
// carries a disallowed scheme (javascript:/data:/…), so no XSS href is emitted.
function anchor(url: string, label: string, style: string): string {
  const safe = safeUrl(url)
  if (!safe) return htmlEsc(label)
  return `<a href="${htmlEsc(safe)}" style="${style}">${htmlEsc(label)}</a>`
}

// Footer nav — one link per line (stacked).
function navLinksHtml(nav: NavJson, color: string): string {
  return nav.primary
    .map(
      (i) =>
        `<p style="margin:0 0 10px;">${anchor(i.url, i.label, `color:${color};text-decoration:none;font-weight:600;`)}</p>`
    )
    .join('')
}

// A single "Client Center" item that reveals the grouped portal links in a
// dropdown — mirrors the real theme's Client Center modal. Uses a native
// <details>/<summary> disclosure (no JS/plugin, and only inline styles so it
// survives WordPress's content sanitizer). Portal links stay grouped inside.
function clientCenterMenu(cc: ClientCenterJson): string {
  if (!cc.enabled || cc.groups.length === 0) return ''
  const showTitles = cc.groups.length > 1
  const groups = cc.groups
    .map((g) => {
      const title = showTitles
        ? `<div style="font-weight:700;color:${c5('primary')};margin:10px 0 4px;font-size:13px;">${htmlEsc(g.title)}</div>`
        : ''
      const links = g.links
        .map((l) => anchor(l.url, l.label, `display:block;color:${c5('primary')};text-decoration:none;padding:5px 0;font-weight:600;`))
        .join('')
      return title + links
    })
    .join('')
  return (
    `<details style="display:inline-block;position:relative;vertical-align:middle;">` +
    `<summary style="list-style:none;cursor:pointer;color:${c5('nearWhite')};">${htmlEsc(cc.label)} ▾</summary>` +
    `<div style="position:absolute;right:0;top:180%;background:${c5('nearWhite')};padding:14px 18px;min-width:240px;text-align:left;box-shadow:0 10px 30px ${c5('primary', 0.25)};border-radius:${radius('card')};z-index:9999;">${groups}</div>` +
    `</details>`
  )
}

// Dark top-strip contents: the Client Center dropdown + phone, right-aligned by
// the text module that wraps it.
function utilityBarHtml(cc: ClientCenterJson, phone: string | undefined): string {
  const ccMenu = clientCenterMenu(cc)
  const phoneHtml = phone
    ? `<span style="color:${c5('nearWhite')};margin-left:22px;font-weight:700;">${htmlEsc(phone)}</span>`
    : ''
  if (!ccMenu && !phoneHtml) return ''
  return `<p style="margin:0;font-size:14px;">${ccMenu}${phoneHtml}</p>`
}

// Logo (or firm name) linked to the home page.
function logoOrName(brand: BrandJson, logoUrl: string | null): string {
  if (logoUrl) {
    return `[et_pb_image src="${esc(logoUrl)}" alt="${esc(brand.logo.alt || brand.firm.name)}" url="/" url_new_window="off" _builder_version="${BV}" _module_preset="default" width="200px" global_colors_info="{}"][/et_pb_image]`
  }
  return `[et_pb_text _builder_version="${BV}" header_2_font="${HEADING_FONT(800)}" header_2_text_color="${c5('primary')}" header_2_font_size="26px" global_colors_info="{}"]<h2 style="margin:0;"><a href="/" style="color:${c5('primary')};text-decoration:none;">${htmlEsc(brand.firm.name)}</a></h2>[/et_pb_text]`
}

function buildHeader(
  brand: BrandJson,
  cc: ClientCenterJson,
  _nav: NavJson,
  logoUrl: string | null
): string {
  // Dark top utility bar: Client Center + phone, right-aligned.
  const util = utilityBarHtml(cc, brand.contact.phone)
  const topBar = util
    ? `[et_pb_section fb_built="1" _builder_version="${BV}" _module_preset="default" background_color="${c5('nearBlack')}" custom_padding="8px||8px|||" global_colors_info="{}" template_type="section"]` +
      `[et_pb_row _builder_version="${BV}" _module_preset="default" width="100%" max_width="92%" module_alignment="center" custom_padding="0px||0px|||" global_colors_info="{}"]` +
      `[et_pb_column type="4_4" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]` +
      `[et_pb_text _builder_version="${BV}" text_orientation="right" background_layout="dark" global_colors_info="{}"]${util}[/et_pb_text]` +
      `[/et_pb_column][/et_pb_row][/et_pb_section]`
    : ''

  // A real Divi menu module — with no fixed menu_id it renders whatever menu is
  // assigned to the theme's Primary location, i.e. the imported "Primary Menu"
  // once the operator assigns it. Managed in Appearance → Menus, with dropdowns.
  const menu =
    `[et_pb_menu menu_id="" _builder_version="${BV}" _module_preset="default" menu_style="left_aligned" ` +
    `menu_font="${HEADING_FONT(600)}" menu_text_color="${c5('heading')}" active_link_color="${c5('actionText')}" ` +
    `dropdown_menu_bg_color="${c5('nearWhite')}" dropdown_menu_text_color="${c5('heading')}" ` +
    `background_color="rgba(0,0,0,0)" module_alignment="right" global_colors_info="{}"][/et_pb_menu]`

  // Main bar: logo (linked home) left, nav menu flowing to the right.
  const mainBar =
    `[et_pb_section fb_built="1" _builder_version="${BV}" _module_preset="default" background_color="${c5('nearWhite')}" custom_padding="14px||14px|||" global_colors_info="{}" template_type="section"]` +
    `[et_pb_row column_structure="1_4,3_4" _builder_version="${BV}" _module_preset="default" width="100%" max_width="92%" module_alignment="center" custom_padding="0px||0px|||" global_colors_info="{}"]` +
    `[et_pb_column type="1_4" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]${logoOrName(brand, logoUrl)}[/et_pb_column]` +
    `[et_pb_column type="3_4" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]${menu}[/et_pb_column]` +
    `[/et_pb_row][/et_pb_section]`

  return topBar + mainBar
}

function buildFooter(brand: BrandJson, nav: NavJson): string {
  const addr = brand.contact.address
  const addrHtml = addr
    ? `<p>${htmlEsc(addr.street)}${addr.line2 ? '<br/>' + htmlEsc(addr.line2) : ''}<br/>${htmlEsc(addr.city)}, ${htmlEsc(addr.state)} ${htmlEsc(addr.zip)}</p>`
    : ''
  const phone = brand.contact.phone ? `<p>${htmlEsc(brand.contact.phone)}</p>` : ''
  const email = brand.contact.email ? `<p>${htmlEsc(brand.contact.email)}</p>` : ''
  const social = brand.social.length
    ? `<p>${brand.social.map((s) => anchor(s.url, s.platform, `color:${c5('nearWhite')};margin-right:14px;`)).join('')}</p>`
    : ''
  const navHtml = navLinksHtml(nav, c5('nearWhite'))

  return (
    `[et_pb_section fb_built="1" _builder_version="${BV}" _module_preset="default" background_color="${c5('nearBlack')}" custom_padding="50px||40px|||" global_colors_info="{}" template_type="section"]` +
    `[et_pb_row column_structure="1_2,1_2" _builder_version="${BV}" _module_preset="default" width="100%" max_width="90%" module_alignment="center" global_colors_info="{}"]` +
    `[et_pb_column type="1_2" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]` +
    `[et_pb_text _builder_version="${BV}" background_layout="dark" text_text_color="${c5('nearWhite')}" global_colors_info="{}"]<h3 style="color:${c5('nearWhite')};">${htmlEsc(brand.firm.name)}</h3>${addrHtml}${phone}${email}[/et_pb_text]` +
    `[/et_pb_column]` +
    `[et_pb_column type="1_2" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]` +
    `[et_pb_text _builder_version="${BV}" text_orientation="right" background_layout="dark" text_text_color="${c5('nearWhite')}" global_colors_info="{}"]${navHtml}${social}[/et_pb_text]` +
    `[/et_pb_column][/et_pb_row][/et_pb_section]`
  )
}

// Divi Library taxonomy terms. Without these the imported layout has no
// `layout_type` and Divi shows Type "—" and hides it from the Theme Builder /
// "Load From Library → Your Saved Layouts" picker. `layout` = a full layout
// (loadable as a whole into a header/footer template); `not_global` keeps it a
// plain editable copy rather than a linked global module.
function layoutTerms() {
  const mk = (name: string, taxonomy: string) => ({
    name,
    slug: name,
    taxonomy,
    parent: 0,
    all_parents: [] as number[],
    description: '',
  })
  return {
    '1': mk('not_global', 'scope'),
    '2': mk('regular', 'module_width'),
    '3': mk('layout', 'layout_type'),
  }
}

// A Divi Library layout record. Field set + terms mirror the reference export
// (raw-docs/Divi Builder Layouts.json) so Divi's importer types it correctly.
function layoutRecord(id: number, title: string, content: string, dateGmt: string) {
  return {
    ID: id,
    post_date: dateGmt,
    post_date_gmt: dateGmt,
    post_content: content,
    post_title: title,
    post_excerpt: '',
    post_status: 'publish',
    comment_status: 'closed',
    ping_status: 'closed',
    post_password: '',
    post_name: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    to_ping: '',
    pinged: '',
    post_modified: dateGmt,
    post_modified_gmt: dateGmt,
    post_content_filtered: '',
    post_parent: 0,
    menu_order: 0,
    post_type: 'et_pb_layout',
    post_mime_type: '',
    comment_count: '0',
    filter: 'raw',
    post_meta: { _et_pb_built_for_post_type: ['page'] },
    terms: layoutTerms(),
  }
}

export function buildDiviLibrary(opts: {
  brand: BrandJson
  clientCenter: ClientCenterJson
  nav: NavJson
  logoUrl: string | null
  style: DiviStyle
  dateGmt: string
}): string {
  const header = applyDiviStyle(buildHeader(opts.brand, opts.clientCenter, opts.nav, opts.logoUrl), opts.style)
  const footer = applyDiviStyle(buildFooter(opts.brand, opts.nav), opts.style)

  // Envelope shape matches a native Divi Library export exactly.
  const envelope = {
    context: 'et_builder_layouts',
    data: {
      '1': layoutRecord(1, `${opts.brand.firm.name} — Header`, header, opts.dateGmt),
      '2': layoutRecord(2, `${opts.brand.firm.name} — Footer`, footer, opts.dateGmt),
    },
    presets: '',
    // The client palette as Divi Global Colors (the layouts link to them). The
    // Customizer import carries the same set; Divi upserts by id.
    global_colors: globalColorEntries(opts.style),
    global_variables: [],
    canvases: [],
    images: [],
    thumbnails: [],
  }

  return JSON.stringify(envelope, null, 2)
}
