// Server-only (imports the native lightningcss module — never import this from
// a 'use client' file). Strict gate for every piece of AI- or admin-authored CSS
// that lands in a client's content/design-overrides.css. That file is compiled
// by the client's Vercel build (globals.css @imports it through Tailwind v4 /
// LightningCSS), so invalid CSS breaks the deploy, not just the preview.
//
// Rules: postcss must parse it; only @media/@supports/@container and @keyframes
// c5-* are allowed; every top-level selector must lead with an allowed target
// ([data-block], [data-component], optional html[data-<state>] prefix, or :root
// custom properties in global scope); hiding/injection declarations are refused;
// url() is limited to small inline SVG; LightningCSS must accept the result.
//
// This is a denylist-plus-scoping gate, not a formal CSS security model — it
// cannot enumerate every possible bypass, only the ones found and closed so
// far (see task-3-findings-r1.md, task-3-findings-r2.md, and
// task-3-findings-r3.md / -r4.md / -r5.md for the round-1..5 reviews). Where practical, prefer
// a structural allowlist (e.g. font-size, the reduced-motion gate, :root's
// shape, animation's duration/delay/iteration-count limits) over another
// denylist pattern — it's harder to bypass with an unanticipated variant.
// Treat any new bypass class the same way: add a regression test, then close
// it here. Known residual hiding vectors (parked, not fixed here — round 3
// and final-review rulings), all deferred to the spec's P4 render gate
// (hidden-block / axe contrast metrics on the rendered page):
//   - var() indirection in font-size/colour (e.g. `font-size: var(--x, 0px)`
//     where --x is later set to 0px in :root) — can't be statically evaluated;
//   - transform: scale(0) (or a near-zero scale);
//   - height/max-height: 0 combined with overflow: hidden;
//   - text-indent pushing text off-screen (e.g. -9999px);
//   - clip-path clipping the element away (e.g. inset(50%));
//   - off-screen positioning (large negative margins, an absolute overlay
//     sized to the viewport covering other content).
// (content-visibility:hidden, filter opacity(), zoom, and scale < 0.2 ARE
// rejected — closed in the pre-merge handoff review.)
import postcss, {
  type AtRule,
  type ChildNode,
  type Container,
  type Declaration,
  type Node,
  type Root,
  type Rule,
} from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { transform } from 'lightningcss'
import { OVERRIDE_BLOCKS } from '@/lib/editor/theme-edit'
import { CHROME_COMPONENTS, HTML_STATE_ATTRS, type CssTarget } from './css-targets'

export type CssScope = { kind: 'target'; target: CssTarget } | { kind: 'global' }
export type SanitizeResult = { ok: true; css: string } | { ok: false; errors: string[] }

const MAX_GLOBAL_BYTES = 16_000
const MAX_GLOBAL_LINES = 400
const MAX_TARGET_BYTES = 4_000
const MAX_TARGET_LINES = 60
const MAX_IMPORTANT = 5
const MAX_SVG_URL_CHARS = 2_048

const ALLOWED_AT_RULES = new Set(['media', 'supports', 'container', 'keyframes'])
// :root may only set design-scale custom properties — never --color-* (owned by
// theme.css) or --font-*-loaded (owned by the fonts module).
const ROOT_PROP_PREFIXES = ['--c5-', '--type-', '--tracking-', '--shadow-', '--overlay-', '--duration-']

type LeadTarget = { kind: 'block' | 'component'; id: string } | { kind: 'root' }

function attrNameFor(target: CssTarget): 'data-block' | 'data-component' {
  return (CHROME_COMPONENTS as readonly string[]).includes(target) ? 'data-component' : 'data-block'
}

// The target a single (non-nested) selector leads with, or null when it isn't
// scoped to one. Accepts an optional `html[data-<state>]…` prefix.
function leadingTarget(sel: selectorParser.Selector): LeadTarget | null {
  const nodes = sel.nodes
  if (nodes.length === 1 && nodes[0].type === 'pseudo' && nodes[0].value === ':root') return { kind: 'root' }
  let i = 0
  if (nodes[0]?.type === 'tag' && nodes[0].value === 'html') {
    i = 1
    while (nodes[i]?.type === 'attribute') {
      const a = nodes[i] as selectorParser.Attribute
      if (!HTML_STATE_ATTRS.includes(a.attribute)) return null
      i++
    }
    if (nodes[i]?.type !== 'combinator') return null
    i++
  }
  for (; i < nodes.length && nodes[i].type !== 'combinator'; i++) {
    const n = nodes[i]
    if (n.type === 'attribute' && n.operator === '=' && (n.attribute === 'data-block' || n.attribute === 'data-component')) {
      return { kind: n.attribute === 'data-block' ? 'block' : 'component', id: n.value ?? '' }
    }
  }
  return null
}

function targetAllowed(t: LeadTarget, scope: CssScope): boolean {
  if (scope.kind === 'target') {
    if (t.kind === 'root') return false
    // The selector's attribute kind ([data-block] vs [data-component]) must
    // match what the scope target actually is — [data-block="navbar"] must
    // not be accepted as styling the navbar chrome component just because
    // the id string matches; "navbar" is not a real block.
    const wantKind = (CHROME_COMPONENTS as readonly string[]).includes(scope.target) ? 'component' : 'block'
    return t.kind === wantKind && t.id === scope.target
  }
  if (t.kind === 'root') return true
  if (t.kind === 'block') return (OVERRIDE_BLOCKS as readonly string[]).includes(t.id)
  return (CHROME_COMPONENTS as readonly string[]).includes(t.id)
}

// True when the selector list contains a nesting (`&`) node with a pseudo
// (:is/:where/:has/:not/:matches/… — any pseudo taking a selector argument)
// among its ancestors in the selector AST.
function hasNestingInsidePseudo(parsed: selectorParser.Root): boolean {
  let found = false
  parsed.walkNesting((n) => {
    let p: selectorParser.Container | undefined = n.parent
    while (p && p.type !== 'root') {
      if (p.type === 'pseudo') {
        found = true
        return false
      }
      p = p.parent
    }
  })
  return found
}

function selectorHasNesting(sel: selectorParser.Selector): boolean {
  let found = false
  sel.walkNesting(() => {
    found = true
    return false
  })
  return found
}

// A selector whose first compound starts with html, body, or :root.
function leadsWithPageAnchor(sel: selectorParser.Selector): boolean {
  const first = sel.nodes[0]
  if (!first) return false
  if (first.type === 'tag') return ['html', 'body'].includes(first.value.toLowerCase())
  return first.type === 'pseudo' && first.value.toLowerCase() === ':root'
}

function hasAncestor(node: ChildNode, pred: (n: Container) => boolean): boolean {
  let p: Node | undefined = node.parent
  while (p && p.type !== 'root' && p.type !== 'document') {
    if (pred(p as Container)) return true
    p = (p as Container).parent
  }
  return false
}

const isRule = (n: Container): boolean => n.type === 'rule'
const isKeyframes = (n: Container): boolean => n.type === 'atrule' && (n as AtRule).name.toLowerCase() === 'keyframes'
// A rule is a "root rule" when its own selector leads with :root. Used to ban
// nesting anything under it — :root has no legitimate use for nested rules,
// and nesting was a way to smuggle in an unchecked selector/declaration.
function isRootRule(n: Container): boolean {
  if (n.type !== 'rule') return false
  try {
    const first = selectorParser().astSync((n as Rule).selector).first
    return !!first && leadingTarget(first)?.kind === 'root'
  } catch {
    return false
  }
}
// Strict reduced-motion gate (round 2: full structural match, not a
// substring test). The whole params string must be exactly the
// no-preference query, optionally extended by one or more `and (<feature>)`
// groups. `not`, `only`, `or`, commas, and media types (anything before the
// first `(`) all fail this match by construction — there's no denylist to
// keep up to date.
const REDUCED_MOTION_GATE_RE = /^\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)(?:\s+and\s+\([^()]*\))*$/
const isReducedMotionGate = (n: Container): boolean => {
  if (!(n.type === 'atrule' && (n as AtRule).name.toLowerCase() === 'media')) return false
  const params = (n as AtRule).params.trim().toLowerCase()
  return REDUCED_MOTION_GATE_RE.test(params)
}

// @keyframes bodies may only use from / to / percentage step selectors.
function isValidKeyframeSelector(selector: string): boolean {
  return selector.split(',').every((part) => {
    const p = part.trim().toLowerCase()
    return p === 'from' || p === 'to' || /^\d+(?:\.\d+)?%$/.test(p)
  })
}

function checkUrls(value: string, errors: string[]) {
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(value))) {
    const raw = m[2]
    if (!/^data:image\/svg\+xml[,;]/i.test(raw)) {
      errors.push('url() may only embed a small inline SVG (data:image/svg+xml) — no remote, relative, or raster URLs.')
      continue
    }
    if (raw.length > MAX_SVG_URL_CHARS) errors.push('url() inline SVG is too large (max 2 KB).')
    let decoded = raw
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      // Keep the raw text; the checks below still apply.
    }
    if (/<script|\bon[a-z]+\s*=|javascript:/i.test(decoded)) errors.push('url() inline SVG contains script — not allowed.')
  }
}

// A colour function's alpha channel must be a plain number or percentage
// (round 2 ruling; round 3 fix: a bare leading dot — `.9`, not just `0.9` — is
// a plain number too and must be accepted) of at least MIN_TEXT_ALPHA (final
// review: the same 0.2 floor as opacity — near-invisible text is hidden text).
// No alpha channel at all means fully opaque — fine. calc()/var() can't be
// statically proven above the floor, so they're rejected too. Only called for
// color / -webkit-text-fill-color; shadows and backgrounds are unaffected.
const MIN_TEXT_ALPHA = 0.2
const ALPHA_NUMBER_RE = /^(?:\d+(?:\.\d+)?|\.\d+)%?$/
function hasInvalidAlpha(value: string): boolean {
  const re = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^)]*)\)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(value))) {
    const inner = m[1]
    let alphaStr: string | undefined
    if (inner.includes('/')) {
      alphaStr = inner.split('/')[1]?.trim()
    } else {
      // Legacy comma syntax only carries alpha as a 4th arg (rgba/hsla).
      const parts = inner.split(',').map((p) => p.trim())
      if (parts.length === 4) alphaStr = parts[3]
    }
    if (!alphaStr) continue
    if (!ALPHA_NUMBER_RE.test(alphaStr)) return true
    const n = alphaStr.endsWith('%') ? parseFloat(alphaStr) / 100 : parseFloat(alphaStr)
    if (n < MIN_TEXT_ALPHA) return true
  }
  return false
}

// Splits a function's argument list on top-level commas only — a comma
// inside a nested function call (e.g. `min(2vw, 3rem)` as clamp()'s 2nd arg,
// or `cubic-bezier(.2,.7,.2,1)` inside an animation shorthand) doesn't count.
function splitTopLevel(s: string, sep: RegExp): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth === 0 && sep.test(ch)) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts.filter((p) => p !== '')
}
const splitTopLevelCommas = (s: string): string[] => splitTopLevel(s, /,/).map((p) => p.trim())
// Tokenizes a shorthand value on top-level whitespace — `cubic-bezier(.2, .7,
// .2, 1)` stays one token even though it contains both commas and spaces.
const tokenizeBalanced = (s: string): string[] => splitTopLevel(s, /\s/)

// Round 4 ruling: ONE numeric grammar for every animation value. A number
// must be canonical and plain — digits with an optional fraction, or a bare
// leading-dot fraction — optionally followed by s/ms. Signs, exponents and any
// other unit are rejected, so `+30s`, `3e1s`, `1e3` can't slip past the limits.
const ANIMATION_NUMBER_RE = /^(?:\d+(?:\.\d+)?|\.\d+)(?:s|ms)?$/
// Anything that starts like a number (optional sign, optional dot, digit).
const NUMERIC_LOOKING_RE = /^[+-]?\.?\d/

type AnimationToken =
  | { kind: 'time'; seconds: number }
  | { kind: 'number'; value: number }
  | { kind: 'badNumber'; raw: string }
  | { kind: 'badFunction'; raw: string }
  | { kind: 'other'; raw: string }

// Round 5 ruling: the only functions allowed anywhere in an animation value.
// Math functions (calc/min/max/clamp/round/…) would otherwise hide a time or
// iteration count from the limits below. Every function name in the token is
// checked, including ones nested inside an allowed function's arguments.
const ANIMATION_FUNCTIONS = new Set(['cubic-bezier', 'linear', 'view', 'scroll'])
function hasDisallowedFunction(token: string): boolean {
  const re = /([\w-]*)\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(token))) {
    if (!ANIMATION_FUNCTIONS.has(m[1].toLowerCase())) return true
  }
  return false
}

// Parses an `animation` / `animation-*` value into its comma-separated layers,
// each a list of classified tokens. Parenthesised groups (e.g.
// `cubic-bezier(.2,.7,.2,1)`) stay one token: `other` when every function in
// it is allowlisted (its arguments are never read as a time or iteration
// count), `badFunction` otherwise.
function parseAnimationLayers(value: string): AnimationToken[][] {
  return splitTopLevelCommas(value).map((layer) =>
    tokenizeBalanced(layer).map((raw): AnimationToken => {
      if (raw.includes('(')) return hasDisallowedFunction(raw) ? { kind: 'badFunction', raw } : { kind: 'other', raw }
      if (!NUMERIC_LOOKING_RE.test(raw)) return { kind: 'other', raw }
      if (!ANIMATION_NUMBER_RE.test(raw)) return { kind: 'badNumber', raw }
      const n = parseFloat(raw)
      if (raw.endsWith('ms')) return { kind: 'time', seconds: n / 1000 }
      if (raw.endsWith('s')) return { kind: 'time', seconds: n }
      return { kind: 'number', value: n }
    })
  )
}

const ANIMATION_NUMBER_MSG = 'animation numbers must be plain, e.g. 0.6s or 600ms'
const ANIMATION_FUNCTION_MSG = 'only cubic-bezier()/linear()/view()/scroll() functions are allowed in animation values'
const MAX_ANIMATION_DURATION_S = 2
const MAX_ANIMATION_DELAY_S = 1

// Per-layer duration/delay/iteration-count limits for `animation` and its
// numeric longhands (round 4: applied to EVERY comma-separated layer, not just
// the first). Any hiding via animation is then at most transient.
function checkAnimationValue(prop: string, rawValue: string, value: string, errors: string[]) {
  for (const layer of parseAnimationLayers(value)) {
    for (const t of layer) {
      if (t.kind === 'badNumber') errors.push(`${prop}: ${rawValue} is not allowed (${ANIMATION_NUMBER_MSG}).`)
      if (t.kind === 'badFunction') errors.push(`${prop}: ${rawValue} is not allowed (${ANIMATION_FUNCTION_MSG}).`)
    }
    const times = layer.flatMap((t) => (t.kind === 'time' ? [t.seconds] : []))
    const numbers = layer.flatMap((t) => (t.kind === 'number' ? [t.value] : []))

    if (prop === 'animation') {
      // Shorthand <time> values appear in order: 1st = duration, 2nd = delay.
      if (times[0] !== undefined && times[0] > MAX_ANIMATION_DURATION_S) {
        errors.push(`animation: ${rawValue} duration must be ≤ ${MAX_ANIMATION_DURATION_S}s.`)
      }
      if (times[1] !== undefined && times[1] > MAX_ANIMATION_DELAY_S) {
        errors.push(`animation: ${rawValue} delay must be ≤ ${MAX_ANIMATION_DELAY_S}s.`)
      }
      if (times.length > 2) errors.push(`animation: ${rawValue} may have at most two time values per layer.`)
      // A bare number in the shorthand is the iteration count.
      if (numbers.some((n) => n !== 1)) {
        errors.push(`animation: ${rawValue} may only use a bare number of 1 (the iteration count).`)
      }
    } else if (prop === 'animation-duration' || prop === 'animation-delay') {
      const max = prop === 'animation-duration' ? MAX_ANIMATION_DURATION_S : MAX_ANIMATION_DELAY_S
      if (layer.length !== 1 || times.length !== 1) {
        errors.push(`${prop}: ${rawValue} must be a plain <num>(s|ms) time value.`)
      } else if (times[0] > max) {
        errors.push(`${prop}: ${rawValue} must be ≤ ${max}s.`)
      }
    } else if (prop === 'animation-iteration-count') {
      if (layer.length !== 1 || numbers.length !== 1 || numbers[0] !== 1) {
        errors.push(`animation-iteration-count: ${rawValue} must be exactly 1.`)
      }
    }
  }
}

// 4-digit (#rgba) and 8-digit (#rrggbbaa) hex colours carry alpha as their
// last nibble/byte; #rgb and #rrggbb have no alpha channel and are fine. The
// alpha must meet the same MIN_TEXT_ALPHA floor as colour functions.
function hasLowAlphaHex(value: string): boolean {
  const re = /#([0-9a-f]{3,8})\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(value))) {
    const hex = m[1]
    if (hex.length === 4 && parseInt(hex[3], 16) / 15 < MIN_TEXT_ALPHA) return true
    if (hex.length === 8 && parseInt(hex.slice(6), 16) / 255 < MIN_TEXT_ALPHA) return true
  }
  return false
}

const FONT_SIZE_KEYWORDS = new Set([
  'small',
  'medium',
  'large',
  'x-large',
  'xx-large',
  'xxx-large',
  'larger',
  'inherit',
  'initial',
  'unset',
  'revert',
])

// A plain px/rem/em length, or null if the value isn't in that exact form
// (round 2: no exponents, no bare leading dot — the number must match
// /^\d+(\.\d+)?$/).
function parsePxRemEm(value: string): { n: number; unit: 'px' | 'rem' | 'em' } | null {
  const m = /^(\d+(?:\.\d+)?)(px|rem|em)$/.exec(value)
  if (!m) return null
  return { n: parseFloat(m[1]), unit: m[2] as 'px' | 'rem' | 'em' }
}

function meetsFontMin(len: { n: number; unit: 'px' | 'rem' | 'em' }): boolean {
  return len.unit === 'px' ? len.n >= 12 : len.n >= 0.75
}

// Round 2 ruling: font-size is a structural allowlist, not a denylist.
// Accept ONLY a px/rem/em length ≥ the minimum, a percentage ≥ 75%, var(),
// clamp() whose first (minimum) argument itself passes the px/rem/em rule,
// or one of the explicitly-allowed keywords. Everything else — 0pt, 0vw,
// 1e-9px, min()/max()/calc(), .5rem, smaller/x-small/xx-small — is rejected.
function fontSizeError(rawValue: string, value: string): string | null {
  const len = parsePxRemEm(value)
  if (len) return meetsFontMin(len) ? null : `font-size: ${rawValue} is too small (min 12px / 0.75rem).`

  const pct = /^(\d+(?:\.\d+)?)%$/.exec(value)
  if (pct) return parseFloat(pct[1]) >= 75 ? null : `font-size: ${rawValue} is too small (min 75%).`

  if (/^var\(\s*--[a-z0-9_-]+\s*(?:,[^)]*)?\)$/i.test(value)) return null

  const clampMatch = /^clamp\((.*)\)$/i.exec(value)
  if (clampMatch) {
    // Split at TOP-LEVEL commas only — the 2nd/3rd arg may itself be a
    // multi-arg nested function (`clamp(1rem, min(2vw, 3rem), 4rem)`); only
    // the first (minimum) argument is checked, per the round-3 ruling.
    const args = splitTopLevelCommas(clampMatch[1])
    const minLen = args.length === 3 ? parsePxRemEm(args[0]) : null
    if (minLen && meetsFontMin(minLen)) return null
    return `font-size: ${rawValue} is not allowed (clamp()'s minimum must be a px/rem/em length ≥ 12px / 0.75rem).`
  }

  if (FONT_SIZE_KEYWORDS.has(value)) return null

  return `font-size: ${rawValue} is not allowed (must be a px/rem/em length, a percentage ≥ 75%, var(), clamp(), or an allowed keyword).`
}

// @keyframes step whose selector includes `to` or a percentage that resolves
// to 100 (round 3: parseFloat, so `100.0%` counts too, not just the literal
// string `100%`) — the animation's resting state. `from { opacity: 0 }`
// entrance animations stay allowed; ending invisible/hidden does not.
function isFinalKeyframeStep(selector: string): boolean {
  return selector.split(',').some((part) => {
    const p = part.trim().toLowerCase()
    if (p === 'to') return true
    const m = /^(\d+(?:\.\d+)?)%$/.exec(p)
    return !!m && parseFloat(m[1]) === 100
  })
}

// Every selector in the owning rule's comma-list, not just the first — a
// declaration applies to ALL of them, so a target-dependent check (currently
// just position:fixed/sticky → navbar-only) must hold for every one.
function checkDeclaration(decl: Declaration, leads: LeadTarget[], errors: string[]) {
  const prop = decl.prop.toLowerCase()
  const value = decl.value.trim().toLowerCase()
  const inKeyframes = hasAncestor(decl, isKeyframes)

  if (prop === 'behavior' || prop === '-moz-binding') errors.push(`${prop} is not allowed.`)
  if (/expression\(|javascript:/.test(value)) errors.push(`${prop}: ${decl.value} is not allowed.`)
  if (prop === 'display' && value === 'none') errors.push('display: none is not allowed (it hides content).')
  if (prop === 'visibility' && (value === 'hidden' || value === 'collapse')) errors.push(`visibility: ${value} is not allowed.`)
  if (prop === 'content-visibility' && value === 'hidden') errors.push('content-visibility: hidden is not allowed (it hides content).')
  if ((prop === 'filter' || prop === 'backdrop-filter') && /\bopacity\(/.test(value)) errors.push(`${prop}: opacity() is not allowed.`)
  if (prop === 'zoom') errors.push('zoom is not allowed.')
  if (prop === 'scale') {
    const tooSmall = value.split(/\s+/).some((v) => {
      if (!/^[\d.]+%?$/.test(v)) return false
      const n = v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v)
      return n < 0.2
    })
    if (tooSmall) errors.push(`scale: ${decl.value} is not allowed (below 0.2 hides content).`)
  }
  if (prop === 'opacity' && !inKeyframes) {
    if (!/^[\d.]+%?$/.test(value)) {
      errors.push(`opacity: ${decl.value} is not allowed (must be a plain number or percentage).`)
    } else {
      const n = value.endsWith('%') ? parseFloat(value) / 100 : parseFloat(value)
      if (!Number.isNaN(n) && n < 0.2) errors.push(`opacity: ${decl.value} is not allowed (below 0.2 hides content).`)
    }
  }
  if (prop === 'content') {
    const isPlain = ['""', "''", 'none'].includes(value)
    const isCounter = /^counter\([a-z_][\w-]*\)$/i.test(value)
    if (!isPlain && !isCounter) errors.push('content: text is not allowed (no injected copy).')
  }
  if ((prop === 'list-style' || prop === 'list-style-type') && /["']/.test(decl.value)) {
    errors.push(`${prop}: custom list markers are not allowed (no injected copy).`)
  }
  if (prop === 'position' && (value === 'fixed' || value === 'sticky' || value === '-webkit-sticky')) {
    const allNavbar = leads.length > 0 && leads.every((l) => l.kind === 'component' && l.id === 'navbar')
    if (!allNavbar) errors.push(`position: ${value} is not allowed outside the navbar.`)
  }
  if (prop === 'font') {
    errors.push(`font: ${decl.value} is not allowed — use the font-family/font-size/… longhands instead.`)
  }
  if (prop === 'color' || prop === '-webkit-text-fill-color') {
    // Round 3: `transparent` anywhere (not just as the whole value — it can
    // ride inside color-mix()), color-mix() itself (any of its stops could
    // still resolve to invisible), and relative-colour syntax `(from …)`
    // (channels can be substituted via var() — unevaluable, ruled a flat ban)
    // are all rejected outright, on top of the existing alpha/hex checks.
    if (
      value.includes('transparent') ||
      value.includes('color-mix(') ||
      /\(from\s/.test(value) ||
      hasInvalidAlpha(value) ||
      hasLowAlphaHex(value)
    ) {
      errors.push(`${prop}: ${decl.value} is not allowed (it hides text).`)
    }
  }
  if (prop === 'font-size') {
    const err = fontSizeError(decl.value, value)
    if (err) errors.push(err)
  }
  if (prop === 'z-index') {
    // Final review: structural allowlist — a plain (optionally negative)
    // integer ≤ 50, or `auto`. `1e9`, `calc(1000)`, `var(--z)`, `+10`, `1.5`
    // are all rejected rather than parsed.
    if (value !== 'auto') {
      if (!/^-?\d+$/.test(value)) errors.push(`z-index: ${decl.value} is not allowed (must be a plain integer ≤ 50, or auto).`)
      else if (parseInt(value, 10) > 50) errors.push(`z-index: ${decl.value} is too high (max 50).`)
    }
  }
  if (prop === 'pointer-events' && value === 'none') errors.push('pointer-events: none is not allowed.')
  if ((prop === 'animation' || prop === 'animation-fill-mode') && /\b(?:forwards|backwards|both)\b/.test(value)) {
    errors.push(`${prop}: ${decl.value} may not use the forwards/backwards/both fill mode (can hide content permanently).`)
  }
  if ((prop === 'animation' || prop === 'animation-name') && value !== 'none' && !hasAncestor(decl, isReducedMotionGate)) {
    errors.push('animations must sit inside @media (prefers-reduced-motion: no-preference).')
  }
  // Round 3: constrain animation STRUCTURALLY rather than chasing more
  // keyframe-content denylist variants — any hiding via animation is then at
  // most transient (≤2s duration, ≤1s delay, exactly one iteration).
  if (prop.startsWith('animation')) {
    if (/\bvar\(/.test(value)) errors.push(`${prop}: ${decl.value} may not use var().`)
    if (/\bsteps\(/.test(value)) errors.push(`${prop}: ${decl.value} may not use steps().`)
    if (/\binfinite\b/.test(value)) errors.push(`${prop}: ${decl.value} may not use infinite.`)
    checkAnimationValue(prop, decl.value, value, errors)
  }
  if (/image-set\(/.test(value)) errors.push(`${prop}: ${decl.value} may not use image-set() (remote fetch risk).`)
  if (/\bsrc\(/.test(value)) errors.push(`${prop}: ${decl.value} may not use src() (remote fetch risk).`)
  if (/\bimage\(/.test(value)) errors.push(`${prop}: ${decl.value} may not use image() (remote fetch risk).`)
  if (/theme\(/.test(value)) errors.push(`${prop}: ${decl.value} may not use theme() (Tailwind-only function).`)
  if (/--spacing\(/.test(value)) errors.push(`${prop}: ${decl.value} may not use --spacing() (Tailwind-only function).`)
  if (/--alpha\(/.test(value)) errors.push(`${prop}: ${decl.value} may not use --alpha() (Tailwind-only function).`)
  if (value.includes('url(')) checkUrls(decl.value, errors)
}

export function sanitizeDesignCss(css: string, scope: CssScope): SanitizeResult {
  const input = css.trim()
  if (!input) return { ok: false, errors: ['The CSS is empty.'] }
  const maxBytes = scope.kind === 'global' ? MAX_GLOBAL_BYTES : MAX_TARGET_BYTES
  if (Buffer.byteLength(input, 'utf8') > maxBytes) return { ok: false, errors: [`The CSS is too large (max ${maxBytes} bytes).`] }
  if (/<\/|<script/i.test(input)) return { ok: false, errors: ['The CSS contains disallowed markup.'] }
  // Legit design CSS never needs an escape. Backslash escapes are how every
  // known bypass in this file smuggled banned tokens (comments, keywords,
  // schemes) past the checks below, so ban them outright, pre-parse.
  if (input.includes('\\')) return { ok: false, errors: ['CSS escapes (\\) are not allowed.'] }

  let root: Root
  try {
    root = postcss.parse(input)
  } catch (err) {
    const reason = err instanceof postcss.CssSyntaxError ? err.reason : 'syntax error'
    return { ok: false, errors: [`The CSS does not parse: ${reason}.`] }
  }

  const errors: string[] = []
  root.walkComments((c) => {
    c.remove()
  })
  // Comments can also survive inside a node's `raws` (postcss keeps the
  // original text there for round-trip fidelity, and the stringifier prefers
  // raws over the clean value) — e.g. `color: red /* marker */` lands in
  // decl.raws.value.raw, `sel /* marker */ h1` in rule.raws.selector.raw, and
  // `@media /* marker */ (...)` in atrule.raws.afterName. Clearing every
  // node's raws forces the stringifier to rebuild from the clean, already
  // comment-free value/selector/params fields.
  root.raws = {}
  root.walk((node) => {
    node.raws = {}
  })

  root.walkAtRules((at) => {
    const name = at.name.toLowerCase()
    if (!ALLOWED_AT_RULES.has(name)) {
      errors.push(`@${at.name} is not allowed (only @media, @supports, @container, and @keyframes c5-*).`)
      return
    }
    if (name === 'keyframes' && !/^c5-[a-z0-9-]+$/i.test(at.params.trim())) {
      errors.push(`@keyframes names must start with c5- (got "${at.params.trim()}").`)
    }
    if (/theme\(|--spacing\(|--alpha\(/i.test(at.params)) {
      errors.push(`@${at.name} params may not use theme()/--spacing()/--alpha() (Tailwind-only function).`)
    }
  })

  root.walkRules((rule: Rule) => {
    let parsed: selectorParser.Root
    try {
      parsed = selectorParser().astSync(rule.selector)
    } catch {
      errors.push(`Selector "${rule.selector}" does not parse.`)
      return
    }

    if (hasAncestor(rule, isKeyframes)) {
      if (!isValidKeyframeSelector(rule.selector)) {
        errors.push(`Keyframe selector "${rule.selector}" must be from, to, or a percentage.`)
        return
      }
      // A step whose selector includes `to`/`100%` is the animation's resting
      // state — it must not end invisible. `from { opacity: 0 }` stays fine.
      if (isFinalKeyframeStep(rule.selector)) {
        for (const child of rule.nodes ?? []) {
          if (child.type !== 'decl') continue
          const p = child.prop.toLowerCase()
          const v = child.value.trim().toLowerCase()
          if (p === 'opacity') {
            // Round 3: must be a plain number/percentage — calc()/var() can't
            // be statically proven safe, so they're rejected outright here
            // rather than only checked when they happen to parse as < 0.2.
            // Round 4: same plain-number grammar as colour alpha, so a
            // leading-dot value like `.9` is accepted.
            if (!ALPHA_NUMBER_RE.test(v)) {
              errors.push(`opacity: ${child.value} is not allowed at a keyframe's final (to/100%) step (must be a plain number or percentage).`)
            } else {
              const n = v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v)
              if (!Number.isNaN(n) && n < 0.2) {
                errors.push(`opacity: ${child.value} is not allowed at a keyframe's final (to/100%) step (can hide content permanently).`)
              }
            }
          }
          if (p === 'visibility' && (v === 'hidden' || v === 'collapse')) {
            errors.push(`visibility: ${v} is not allowed at a keyframe's final (to/100%) step (can hide content permanently).`)
          }
        }
      }
      return
    }

    // The ~ / + combinators reach outside the rule's own subtree (siblings),
    // which is how a rule scoped to one block could style another. Banned
    // everywhere a selector can appear — top-level or nested. > and the
    // descendant combinator (space) stay allowed.
    let hasBannedCombinator = false
    parsed.walk((n) => {
      if (n.type === 'combinator' && (n.value === '~' || n.value === '+')) hasBannedCombinator = true
    })
    if (hasBannedCombinator) {
      errors.push(`Selector "${rule.selector}" may not use the ~ or + combinator (cross-element/cross-block styling).`)
    }

    // :root must be the ONLY selector in its rule's comma-list — mixing it
    // with anything else (`[data-block="hero"], :root { … }`) let an
    // unscoped/root-privileged rule ride along with a normal one.
    let hasRootBranch = false
    parsed.each((sel) => {
      if (leadingTarget(sel)?.kind === 'root') hasRootBranch = true
    })
    if (hasRootBranch && parsed.nodes.length > 1) {
      errors.push(`Selector "${rule.selector}" mixes :root with another selector — :root must be the only selector in its rule.`)
      return
    }

    if (hasAncestor(rule, isRootRule)) {
      errors.push(`Selector "${rule.selector}" may not nest a rule under :root.`)
      return
    }

    // Final review: `&` inside a pseudo-class argument (`:is(body, &) p`,
    // `html:has(&) body`, `:not(&)`) no longer anchors the selector to the
    // block — the pseudo can match via its OTHER arguments or an ancestor, so
    // the rule escapes its scope. Rejected anywhere a selector appears.
    if (hasNestingInsidePseudo(parsed)) {
      errors.push(`Selector "${rule.selector}" may not use & inside a pseudo-class argument (it un-scopes the rule).`)
      return
    }

    if (hasAncestor(rule, isRule)) {
      // A nested rule (e.g. `& h1`, `&:hover`, `body &`, or the implicit
      // descendant form `h1`) inherits its parent's target scope via `&` — it
      // doesn't need to (and can't) redeclare its own
      // [data-block]/[data-component] lead. The combinator/root-nesting/
      // pseudo-& bans above still apply to it. A branch WITHOUT `&` that leads
      // with an explicit page-level anchor (html/body/:root) is refused: it
      // reads as page-wide styling, whatever the nesting spec makes of it.
      parsed.each((sel) => {
        if (!selectorHasNesting(sel) && leadsWithPageAnchor(sel)) {
          errors.push(`Nested selector "${sel.toString().trim()}" may not lead with html/body/:root — start it with & or a descendant of the block.`)
        }
      })
      return
    }

    parsed.each((sel) => {
      const lead = leadingTarget(sel)
      if (!lead || !targetAllowed(lead, scope)) {
        const where = scope.kind === 'target' ? `[${attrNameFor(scope.target)}="${scope.target}"]` : 'a known [data-block] / [data-component] / :root'
        errors.push(`Selector "${sel.toString().trim()}" must be scoped to ${where}.`)
        return
      }
      if (lead.kind === 'root') {
        // :root may contain ONLY direct-child custom-property declarations —
        // no nested rules or at-rules (that's how a declaration nested inside
        // `:root { @media {…} }` previously escaped this check entirely,
        // since it's never a direct child of the :root rule).
        for (const child of rule.nodes ?? []) {
          if (child.type !== 'decl') {
            errors.push(':root may only contain direct custom-property declarations — no nested rules or at-rules.')
            continue
          }
          const prop = child.prop.toLowerCase()
          if (!prop.startsWith('--')) errors.push(`:root may only set custom properties (got ${child.prop}).`)
          else if (!ROOT_PROP_PREFIXES.some((p) => prop.startsWith(p))) {
            errors.push(`:root may not set ${child.prop} (allowed prefixes: ${ROOT_PROP_PREFIXES.join(', ')}).`)
          }
        }
      }
    })
  })

  let important = 0
  root.walkDecls((decl) => {
    if (decl.important) important++
    // A declaration is valid wherever it has ANY ancestor rule — including a
    // rule nested inside @media/@supports/@container inside that rule (e.g.
    // `[data-block="hero"] { @media (min-width: 768px) { … } }`), not only
    // as a direct child of one.
    if (!hasAncestor(decl, isRule)) {
      errors.push(`Declaration "${decl.prop}" must be inside a rule.`)
      return
    }
    // Resolve the owning rule as the OUTERMOST rule ancestor — walk all the
    // way to root and keep the last (outermost) Rule seen, skipping over any
    // at-rules along the way, rather than stopping at whatever node happens
    // to sit directly under root (which can itself be an at-rule).
    let ownerRule: Rule | null = null
    let p: Node | undefined = decl.parent
    while (p && p.type !== 'root' && p.type !== 'document') {
      if (p.type === 'rule') ownerRule = p as Rule
      p = (p as Container).parent
    }
    // A declaration applies to every selector in the owning rule's
    // comma-list, not just the first — collect all of them.
    let leads: LeadTarget[] = []
    if (ownerRule) {
      try {
        selectorParser().astSync(ownerRule.selector).each((sel) => {
          const l = leadingTarget(sel)
          if (l) leads.push(l)
        })
      } catch {
        leads = []
      }
    }
    checkDeclaration(decl, leads, errors)
  })
  if (important > MAX_IMPORTANT) errors.push(`Too many !important declarations (${important}; max ${MAX_IMPORTANT}).`)

  const out = root.toString().trim()
  const maxLines = scope.kind === 'global' ? MAX_GLOBAL_LINES : MAX_TARGET_LINES
  const lines = out.split('\n').length
  if (lines > maxLines) errors.push(`The CSS has ${lines} lines (max ${maxLines}).`)
  // Belt-and-braces: even after scrubbing comment nodes and raws above, if
  // any comment marker still made it into the serialized output, refuse it
  // rather than trust that the scrub above was exhaustive.
  if (out.includes('/*') || out.includes('*/')) {
    errors.push('The CSS still contains a comment marker after sanitizing.')
  }

  if (errors.length === 0) {
    try {
      transform({ filename: 'design-overrides.css', code: Buffer.from(out), errorRecovery: false })
    } catch (err) {
      errors.push(`The CSS does not parse in LightningCSS: ${err instanceof Error ? err.message : 'unknown error'}.`)
    }
  }

  return errors.length ? { ok: false, errors: Array.from(new Set(errors)) } : { ok: true, css: out }
}
