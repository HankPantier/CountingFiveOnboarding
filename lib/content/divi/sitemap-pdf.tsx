// ---------------------------------------------------------------------------
// Sitemap PDF for the WordPress import (Divi export bridge — see ./README.md).
//
//   1. Summary — counts, menu rules, header CTA, import order.
//   2. Schematic — the shared layout, vector, scaled to a landscape page.
//      Shapes go through <Svg>; labels are absolutely positioned <Text> so they
//      get real font sizing (react-pdf's SVG text props don't take a size).
//   3. Page directory — menu order, then not-in-nav pages, with each page's
//      WordPress URL, parent and SEO fields.
// Node runtime only (@react-pdf/renderer).
// ---------------------------------------------------------------------------

import path from 'node:path'
import { Document, Font, Page, Polyline, Rect, StyleSheet, Svg, Text, View, renderToBuffer } from '@react-pdf/renderer'
import type { SitemapLayout, SitemapTheme } from './sitemap-layout'
import { boxStyle, SITEMAP_FONT_FAMILY } from './sitemap-svg'
import { flattenMenu, type SitemapModel, type SitemapNode } from './sitemap'
import { GLOBAL_COLOR_LABEL, gcidFor, PALETTE_ROLES, type DiviStyle } from './style'

const FONT_DIR = path.join(process.cwd(), 'lib/content/divi/assets')
let fontsRegistered = false
function registerFonts() {
  if (fontsRegistered) return
  Font.register({
    family: SITEMAP_FONT_FAMILY,
    fonts: [
      { src: path.join(FONT_DIR, 'OpenSans-Regular.ttf') },
      { src: path.join(FONT_DIR, 'OpenSans-Bold.ttf'), fontWeight: 700 },
    ],
  })
  Font.registerHyphenationCallback((word) => [word])
  fontsRegistered = true
}

// Landscape Letter, 36pt margins.
const LAND_W = 792
const LAND_H = 612
const MARGIN = 36

const KIND_LABEL: Record<SitemapNode['kind'], string> = {
  page: 'Page',
  'synthesized-section': 'Auto-created section landing page',
  'synthesized-home': 'Auto-created home page',
  'custom-link': 'Menu link (no page)',
}

function makeStyles(t: SitemapTheme) {
  return StyleSheet.create({
    page: { fontFamily: SITEMAP_FONT_FAMILY, fontSize: 10, color: t.ink, padding: MARGIN, backgroundColor: t.paper },
    h1: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
    h2: { fontSize: 14, fontWeight: 700, marginTop: 18, marginBottom: 8, color: t.primary },
    muted: { color: t.muted },
    para: { marginBottom: 6, lineHeight: 1.35 },
    statRow: { flexDirection: 'row', marginTop: 14, marginBottom: 4 },
    stat: { marginRight: 28 },
    statNum: { fontSize: 20, fontWeight: 700, color: t.primary },
    warn: { marginTop: 10, padding: 8, borderWidth: 1, borderColor: t.primary, borderRadius: 4, fontWeight: 700 },
    entry: { marginBottom: 9, paddingBottom: 8, borderBottomWidth: 0.75, borderBottomColor: t.line },
    entryTitle: { fontSize: 11, fontWeight: 700 },
    field: { flexDirection: 'row', marginTop: 2 },
    fieldLabel: { width: 96, color: t.muted, fontSize: 8.5 },
    fieldValue: { flex: 1, fontSize: 8.5 },
    footer: { position: 'absolute', bottom: 18, left: MARGIN, right: MARGIN, fontSize: 8, color: t.muted },
  })
}

type Styles = ReturnType<typeof makeStyles>

function Field({ s, label, value }: { s: Styles; label: string; value: string }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value || '—'}</Text>
    </View>
  )
}

function Entry({ s, node, depth }: { s: Styles; node: SitemapNode; depth: number }) {
  const isLink = node.kind === 'custom-link'
  return (
    <View style={[s.entry, { marginLeft: depth * 16 }]} wrap={false}>
      <Text style={s.entryTitle}>
        {node.menuPosition ? `${node.menuPosition}  ` : ''}
        {node.title}
      </Text>
      {isLink ? (
        <Field s={s} label="Links to" value={node.path} />
      ) : (
        <>
          <Field s={s} label="WordPress URL" value={node.wpUrl} />
          <Field s={s} label="Parent page" value={node.parentTitle ?? '(top level)'} />
          <Field s={s} label="Menu" value={node.menuPosition ? `Primary Menu, position ${node.menuPosition}` : 'Not in menu'} />
          <Field s={s} label="Type" value={KIND_LABEL[node.kind]} />
          {node.kind === 'page' && (
            <>
              <Field s={s} label="Meta title" value={node.seo.metaTitle} />
              <Field s={s} label="Meta description" value={node.seo.metaDescription} />
              <Field s={s} label="Target keyword" value={node.seo.targetKeyword} />
            </>
          )}
        </>
      )}
    </View>
  )
}

function Schematic({ layout, t }: { layout: SitemapLayout; t: SitemapTheme }) {
  const availW = LAND_W - MARGIN * 2
  const availH = LAND_H - MARGIN * 2
  const k = Math.min(availW / layout.width, availH / layout.height)
  const w = layout.width * k
  const h = layout.height * k
  // SVG text y is the baseline; a Text box's top sits ~0.8em above it.
  const label = (x: number, y: number, size: number, bold: boolean, color: string, text: string, key: string, opacity = 1) => (
    <Text
      key={key}
      style={{
        position: 'absolute',
        left: x * k,
        top: (y - size * 0.82) * k,
        fontSize: size * k,
        fontWeight: bold ? 700 : 400,
        color,
        opacity,
      }}
    >
      {text}
    </Text>
  )
  return (
    <View style={{ width: w, height: h, position: 'relative' }}>
      <Svg width={w} height={h} viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ position: 'absolute', left: 0, top: 0 }}>
        {layout.groups.map((g, i) => (
          <Rect key={`g${i}`} x={g.x} y={g.y} width={g.w} height={g.h} rx={12} fill="none" stroke={t.line} strokeWidth={1.5} strokeDasharray="6 5" />
        ))}
        {layout.lines.map((l, i) => (
          <Polyline key={`l${i}`} points={l.points.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={t.line} strokeWidth={1.5} />
        ))}
        {layout.boxes.map((b, i) => {
          const st = boxStyle(b.variant, t)
          return (
            <Rect
              key={`b${i}`}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx={st.radius}
              fill={st.fill}
              stroke={st.stroke}
              strokeWidth={1.25}
              {...(st.dashed ? { strokeDasharray: '5 4' } : {})}
            />
          )
        })}
      </Svg>
      {layout.texts.map((x, i) => label(x.x, x.y, x.size, x.bold, x.muted ? t.muted : t.ink, x.text, `t${i}`))}
      {layout.boxes.flatMap((b, i) => {
        const st = boxStyle(b.variant, t)
        const out = [
          label(b.x + 10, b.y + 19, 12.5, true, st.title, b.title, `bt${i}`),
          label(b.x + 10, b.y + 35, 9.5, false, st.sub, b.sub, `bs${i}`, st.subOpacity),
        ]
        if (b.tag) {
          const tagW = b.tag.length * 5.2
          out.push(label(b.x + b.w - 10 - tagW, b.y + 18, 8.5, false, st.sub, b.tag, `bg${i}`, st.subOpacity))
        }
        return out
      })}
    </View>
  )
}

function Styling({ s, style }: { s: Styles; style: DiviStyle }) {
  const shape = style.roundness === 'pill' ? 'pill' : style.roundness === 'soft' ? 'soft (8px)' : 'square (4px)'
  return (
    <View wrap={false}>
      <Text style={s.h2}>Styling</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
        {PALETTE_ROLES.map((role) => (
          <View key={role} style={{ width: '33%', flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: style.palette[role], borderWidth: 0.75, borderColor: '#CBD5E1', marginRight: 6 }} />
            <View>
              <Text style={{ fontSize: 9, fontWeight: 700 }}>{GLOBAL_COLOR_LABEL[role]}</Text>
              <Text style={[s.muted, { fontSize: 8 }]}>
                {style.palette[role]} · {gcidFor(role)}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={s.para}>
        • Fonts: {style.fonts.heading} (headings), {style.fonts.body} (body){style.treatments.serifHeadlines ? `, ${style.fonts.accent} (serif H1/H2)` : ''}.
        Buttons: {shape}, action colour. Spacing: {style.density}.
      </Text>
      <Text style={s.para}>
        • Import the -divi-customizer.json first: it sets these Global Colors, fonts, H1–H6 sizes and buttons, and adds a
        “Revaltus brand” block to Additional CSS. Every page module links to the Global Colors.
      </Text>
      <Text style={[s.para, s.muted]}>
        Not carried over: Design Studio custom CSS and style axes (they target the client site’s own markup).
      </Text>
    </View>
  )
}

export async function renderSitemapPdf(model: SitemapModel, layout: SitemapLayout, t: SitemapTheme, style?: DiviStyle): Promise<Buffer> {
  registerFonts()
  const s = makeStyles(t)
  const menuRows = flattenMenu(model.menu)
  const footer = (
    <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `${model.firmName} — site map · ${model.generatedAt} · ${pageNumber}/${totalPages}`} />
  )

  const doc = (
    <Document title={`${model.firmName} — site map`} author="Revaltus">
      <Page size="LETTER" style={s.page}>
        <Text style={s.h1}>{model.firmName}</Text>
        <Text style={[s.para, s.muted]}>Site map for the WordPress import · generated {model.generatedAt}</Text>

        <View style={s.statRow}>
          {[
            [model.counts.pages, 'pages imported'],
            [model.counts.inMenu, 'in the Primary Menu'],
            [model.counts.notInNav, 'not in any menu'],
            [model.counts.synthesized, 'auto-created'],
          ].map(([n, l]) => (
            <View key={String(l)} style={s.stat}>
              <Text style={s.statNum}>{String(n)}</Text>
              <Text style={s.muted}>{String(l)}</Text>
            </View>
          ))}
        </View>

        {!model.navConfigured && (
          <Text style={s.warn}>
            No navigation was configured in the editor, so the import creates an empty Primary Menu. Build the menu by hand in
            Appearance {'>'} Menus.
          </Text>
        )}

        <Text style={s.h2}>How the structure maps to WordPress</Text>
        <Text style={s.para}>
          • The Primary Menu is the navigation from the content editor’s Pages sidebar: same items, same order, same dropdown nesting.
        </Text>
        <Text style={s.para}>
          • Pages listed under “Not in navigation” are imported as normal pages but are not assigned to any menu. Link to them from
          page content, the footer or a secondary menu if needed.
        </Text>
        <Text style={s.para}>
          • Pages nested under a menu parent become WordPress child pages, so their permalink is /parent/child (shown as “WordPress
          URL” in the directory).
        </Text>
        <Text style={s.para}>
          • “Auto-created” pages did not exist on the source site: a landing page for a dropdown heading that had none, or a Home page
          when the site had no front page. Review or replace them.
        </Text>
        {model.cta && (
          <Text style={s.para}>
            • Header button: “{model.cta.label}” links to {model.cta.url}. It is part of the header layout, not the Primary Menu.
          </Text>
        )}

        {style && <Styling s={s} style={style} />}

        <View wrap={false}>
          <Text style={s.h2}>Import order</Text>
          <Text style={s.para}>0. Theme Customizer {'>'} portability {'>'} Import: the -divi-customizer.json (styling, first).</Text>
          <Text style={s.para}>1. Tools {'>'} Import {'>'} WordPress: import the .wxr (pages + Primary Menu).</Text>
          <Text style={s.para}>2. Divi Library: import the -divi-library.json; assign Header + Footer in Theme Builder.</Text>
          <Text style={s.para}>3. Appearance {'>'} Menus: assign “Primary Menu” to the Primary location.</Text>
          <Text style={s.para}>4. Settings {'>'} Reading: set the static front page to “Home”.</Text>
          <Text style={s.para}>5. Use the page directory in this document to check each page and fill its SEO fields.</Text>
          <Text style={[s.para, s.muted]}>Full steps are in README.txt. The schematic is also included as -sitemap.svg / .png.</Text>
        </View>
        {footer}
      </Page>

      <Page size="LETTER" orientation="landscape" style={s.page}>
        <Schematic layout={layout} t={t} />
        {footer}
      </Page>

      <Page size="LETTER" style={s.page} wrap>
        <Text style={s.h1}>Page directory</Text>
        <Text style={s.h2}>Home</Text>
        <Entry s={s} node={model.home} depth={0} />
        <Text style={s.h2}>Primary Menu</Text>
        {menuRows.length === 0 ? (
          <Text style={[s.para, s.muted]}>No menu items.</Text>
        ) : (
          menuRows.map(({ node, depth }, i) => <Entry key={`m${i}`} s={s} node={node} depth={depth} />)
        )}
        <Text style={s.h2}>Not in navigation</Text>
        {model.notInNav.length === 0 && model.navConfigured ? (
          <Text style={[s.para, s.muted]}>None — every page is reachable from the menu.</Text>
        ) : model.notInNav.length === 0 ? (
          <Text style={[s.para, s.muted]}>None.</Text>
        ) : (
          model.notInNav.map((node, i) => <Entry key={`n${i}`} s={s} node={node} depth={0} />)
        )}
        {footer}
      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}
