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

const BV = '4.27.4'

function esc(value: string): string {
  return (value ?? '').replace(/"/g, '%22').replace(/\r?\n/g, ' ').trim()
}

function htmlEsc(value: string): string {
  return (value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function navLinksHtml(nav: NavJson, color: string): string {
  const links = nav.primary
    .map((i) => `<a href="${htmlEsc(i.url)}" style="color:${color};margin-right:18px;text-decoration:none;font-weight:600;">${htmlEsc(i.label)}</a>`)
    .join('')
  return `<p>${links}</p>`
}

function clientCenterHtml(cc: ClientCenterJson, color: string): string {
  if (!cc.enabled || cc.groups.length === 0) return ''
  const groups = cc.groups
    .map((g) => {
      const links = g.links
        .map((l) => `<li><a href="${htmlEsc(l.url)}" style="color:${color};">${htmlEsc(l.label)}</a></li>`)
        .join('')
      return `<h4 style="color:${color};">${htmlEsc(g.title)}</h4><ul>${links}</ul>`
    })
    .join('')
  return `<h3 style="color:${color};">${htmlEsc(cc.label)}</h3>${groups}`
}

function logoOrName(brand: BrandJson, logoUrl: string | null, color: string): string {
  if (logoUrl) {
    return `[et_pb_image src="${esc(logoUrl)}" alt="${esc(brand.logo.alt || brand.firm.name)}" _builder_version="${BV}" _module_preset="default" width="220px" global_colors_info="{}"][/et_pb_image]`
  }
  return `[et_pb_text _builder_version="${BV}" header_2_font="Inter|800|||||||" header_2_text_color="${color}" header_2_font_size="26px" global_colors_info="{}"]<h2 style="color:${color};">${htmlEsc(brand.firm.name)}</h2>[/et_pb_text]`
}

function buildHeader(
  brand: BrandJson,
  cc: ClientCenterJson,
  nav: NavJson,
  logoUrl: string | null
): string {
  const primary = brand.palette.primary || '#003B71'
  const phone = brand.contact.phone
  const ccHtml = clientCenterHtml(cc, primary)
  const rightText =
    navLinksHtml(nav, primary) +
    (phone ? `<p style="font-weight:700;color:${primary};">${htmlEsc(phone)}</p>` : '') +
    (ccHtml ? `<div>${ccHtml}</div>` : '')

  return (
    `[et_pb_section fb_built="1" _builder_version="${BV}" _module_preset="default" background_color="#FFFFFF" custom_padding="16px||16px|||" global_colors_info="{}" template_type="section"]` +
    `[et_pb_row column_structure="1_3,2_3" _builder_version="${BV}" _module_preset="default" width="100%" max_width="90%" module_alignment="center" global_colors_info="{}"]` +
    `[et_pb_column type="1_3" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]${logoOrName(brand, logoUrl, primary)}[/et_pb_column]` +
    `[et_pb_column type="2_3" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]` +
    `[et_pb_text _builder_version="${BV}" text_orientation="right" global_colors_info="{}"]${rightText}[/et_pb_text]` +
    `[/et_pb_column][/et_pb_row][/et_pb_section]`
  )
}

function buildFooter(brand: BrandJson, nav: NavJson): string {
  const addr = brand.contact.address
  const addrHtml = addr
    ? `<p>${htmlEsc(addr.street)}${addr.line2 ? '<br/>' + htmlEsc(addr.line2) : ''}<br/>${htmlEsc(addr.city)}, ${htmlEsc(addr.state)} ${htmlEsc(addr.zip)}</p>`
    : ''
  const phone = brand.contact.phone ? `<p>${htmlEsc(brand.contact.phone)}</p>` : ''
  const email = brand.contact.email ? `<p>${htmlEsc(brand.contact.email)}</p>` : ''
  const social = brand.social.length
    ? `<p>${brand.social.map((s) => `<a href="${htmlEsc(s.url)}" style="color:#FFFFFF;margin-right:14px;">${htmlEsc(s.platform)}</a>`).join('')}</p>`
    : ''
  const navHtml = navLinksHtml(nav, '#FFFFFF')

  return (
    `[et_pb_section fb_built="1" _builder_version="${BV}" _module_preset="default" background_color="#003B71" custom_padding="50px||40px|||" global_colors_info="{}" template_type="section"]` +
    `[et_pb_row column_structure="1_2,1_2" _builder_version="${BV}" _module_preset="default" width="100%" max_width="90%" module_alignment="center" global_colors_info="{}"]` +
    `[et_pb_column type="1_2" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]` +
    `[et_pb_text _builder_version="${BV}" background_layout="dark" text_text_color="#EEEEEE" global_colors_info="{}"]<h3 style="color:#FFFFFF;">${htmlEsc(brand.firm.name)}</h3>${addrHtml}${phone}${email}[/et_pb_text]` +
    `[/et_pb_column]` +
    `[et_pb_column type="1_2" _builder_version="${BV}" _module_preset="default" global_colors_info="{}"]` +
    `[et_pb_text _builder_version="${BV}" text_orientation="right" background_layout="dark" text_text_color="#EEEEEE" global_colors_info="{}"]${navHtml}${social}[/et_pb_text]` +
    `[/et_pb_column][/et_pb_row][/et_pb_section]`
  )
}

// A Divi Library layout record. Field set mirrors the reference export
// (raw-docs/Divi Builder Layouts.json) closely enough for Divi's importer.
function layoutRecord(id: number, title: string, content: string, dateGmt: string) {
  return {
    ID: id,
    post_title: title,
    post_content: content,
    post_type: 'et_pb_layout',
    post_status: 'publish',
    post_name: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    post_date: dateGmt,
    post_date_gmt: dateGmt,
  }
}

export function buildDiviLibrary(opts: {
  brand: BrandJson
  clientCenter: ClientCenterJson
  nav: NavJson
  logoUrl: string | null
  dateGmt: string
}): string {
  const header = buildHeader(opts.brand, opts.clientCenter, opts.nav, opts.logoUrl)
  const footer = buildFooter(opts.brand, opts.nav)

  const envelope = {
    context: 'et_builder_layouts',
    data: {
      '1': layoutRecord(1, `${opts.brand.firm.name} — Header`, header, opts.dateGmt),
      '2': layoutRecord(2, `${opts.brand.firm.name} — Footer`, footer, opts.dateGmt),
    },
    presets: {},
    global_colors: [],
    images: {},
    thumbnails: {},
  }

  return JSON.stringify(envelope, null, 2)
}
