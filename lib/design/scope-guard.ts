// Authoring-time consistency guard for CSS the design CHAT writes (not
// concepts, not restores). Every chat lever is site-wide, but a fragment is
// scoped to one block type — so "make the font X" or "make the button navy"
// solved inside one block's CSS silently forks that block from the rest of the
// site. Refused: a font-family other than the --font-* variables, and literal
// colours (they belong in set_fonts / set_palette / the --color-* variables).
// Warned: button rules inside ONE block's fragment (legitimately differ on a
// dark band, so the model is told the scope rather than blocked).
//
// Delta, like the layout guard: only declarations the edit INTRODUCES count —
// a fragment that already carried a literal colour (an applied concept) can
// still be edited without first being migrated.
import postcss, { type Declaration, type Root } from 'postcss'
import selectorParser from 'postcss-selector-parser'
import type { CssFragmentKey } from './chat-edits'

const CSS_NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue ' +
    'chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey ' +
    'darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray ' +
    'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen ' +
    'fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen ' +
    'lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime ' +
    'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive ' +
    'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
    'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke ' +
    'yellow yellowgreen'
  ).split(' ')
)

// Where a brand colour would be written. Shadows are left out on purpose: a
// neutral rgba() shadow is depth, not brand colour.
const COLOR_PROP_RE = /^(color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|fill|stroke|text-decoration(-color)?|column-rule(-color)?|caret-color|accent-color|text-emphasis(-color)?)$/
const COLOR_FN_RE = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i
const HEX_RE = /#[0-9a-f]{3,8}\b/i

// A palette tint (color-mix with a --color-* variable) is consistent by
// construction, var() fallbacks never render on a themed site, and an inline
// SVG url() is an icon, not a surface colour: drop all three before scanning.
function withoutTokenExpressions(value: string): string {
  let v = value.replace(/url\((?:"[^"]*"|'[^']*'|[^()]*)\)/gi, ' ')
  for (let i = 0; i < 6; i++) {
    const next = v.replace(/color-mix\([^()]*var\(--color-[^()]*\)[^()]*\)/gi, ' ').replace(/var\([^()]*\)/gi, ' ')
    if (next === v) break
    v = next
  }
  return v
}

function hasLiteralColor(value: string): boolean {
  const v = withoutTokenExpressions(value)
  if (HEX_RE.test(v) || COLOR_FN_RE.test(v)) return true
  return v
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((w) => CSS_NAMED_COLORS.has(w))
}

function isTokenFont(value: string): boolean {
  const v = value.replace(/\s+/g, '').toLowerCase()
  return /^var\(--font-(heading|body|accent)\)$/.test(v) || v === 'inherit' || v === 'initial' || v === 'unset'
}

const declKey = (d: Declaration) => `${d.prop.toLowerCase()}:${d.value.replace(/\s+/g, ' ').trim().toLowerCase()}`

function parse(css: string): Root | null {
  try {
    return postcss.parse(css)
  } catch {
    return null // the sanitizer reports parse errors
  }
}

function violations(root: Root): Map<string, string> {
  const out = new Map<string, string>()
  root.walkDecls((d) => {
    const prop = d.prop.toLowerCase()
    const shown = `${d.prop}: ${d.value.trim()}`.slice(0, 120)
    if (prop === 'font-family' && !isTokenFont(d.value)) {
      out.set(
        declKey(d),
        `${shown} is not allowed — a font named in CSS makes those sections differ from the rest of the site. Change the site font with set_fonts, or use var(--font-heading), var(--font-body) or var(--font-accent).`
      )
    } else if (COLOR_PROP_RE.test(prop) && hasLiteralColor(d.value)) {
      out.set(
        declKey(d),
        `${shown} is not allowed — a literal colour creates a one-off shade the palette doesn't control. Use a --color-* variable (e.g. var(--color-action), var(--color-primary), var(--color-near-white)), or change the palette with set_palette.`
      )
    }
  })
  return out
}

// Refusals for the CSS an edit writes, minus any already carried by one of
// the `allowed` fragments (the fragment being replaced, and — for "Fix in
// chat" — the adopted concept's fragment the model is bringing over).
export function scopeGuardErrors(css: string, allowed: ReadonlyArray<string | null>): string[] {
  const root = parse(css)
  if (!root) return []
  const existing = new Set<string>()
  for (const text of allowed) {
    const r = text ? parse(text) : null
    if (r) for (const key of violations(r).keys()) existing.add(key)
  }
  return [...violations(root)].filter(([key]) => !existing.has(key)).map(([, msg]) => msg)
}

function selectsButton(selector: string): boolean {
  let hit = false
  try {
    selectorParser((sel) => {
      sel.walk((n) => {
        if (n.type === 'tag' && n.value.toLowerCase() === 'button') hit = true
        if (n.type === 'attribute' && n.attribute === 'data-c5' && (n.value ?? '').replace(/["']/g, '').trim() === 'button') hit = true
        if (n.type === 'class' && /\bbtn\b|button/i.test(n.value)) hit = true
      })
    }).processSync(selector)
  } catch {
    return false
  }
  return hit
}

// Advisory only (the edit is staged): button rules in ONE block/chrome
// fragment restyle that section type's buttons, not the site's.
export function scopeGuardWarnings(css: string, target: CssFragmentKey): string[] {
  if (target === 'global') return []
  const root = parse(css)
  if (!root) return []
  let styled = false
  root.walkRules((r) => {
    if (selectsButton(r.selector)) styled = true
  })
  return styled
    ? [
        `Scope: these button rules only change buttons inside "${target}" sections (on every page that has one) — other buttons across the site are unchanged. If the admin asked about buttons in general, undo this and use set_style_axes({ buttons }) or set_tokens radius instead, and say which you did.`,
      ]
    : []
}
