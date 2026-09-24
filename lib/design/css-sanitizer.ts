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
// far (see task-3-findings-r1.md for the round-1 review). Treat any new
// bypass class the same way: add a regression test, then close it here.
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
// Strict reduced-motion gate: exactly the no-preference query, no `not`, no
// comma-separated query list (a comma is `or`, which can smuggle in an
// always-true branch alongside the no-preference one).
const isReducedMotionGate = (n: Container): boolean => {
  if (!(n.type === 'atrule' && (n as AtRule).name.toLowerCase() === 'media')) return false
  const params = (n as AtRule).params.toLowerCase()
  return (
    /\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)/.test(params) &&
    !/\bnot\b/.test(params) &&
    !params.includes(',')
  )
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

// Alpha-zero colours (rgb(.../ 0), rgb(.../0%), legacy rgba(...,0) / hsla(...,0))
// hide text as effectively as `transparent` does. Returns true only when an
// alpha channel is present AND statically resolves to exactly zero.
function hasZeroAlpha(value: string): boolean {
  const re = /\b(?:rgba?|hsla?)\(([^)]*)\)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(value))) {
    const inner = m[1]
    let alphaStr: string | undefined
    if (inner.includes('/')) {
      alphaStr = inner.split('/')[1]?.trim()
    } else {
      const parts = inner.split(',').map((p) => p.trim())
      if (parts.length === 4) alphaStr = parts[3]
    }
    if (!alphaStr) continue
    const n = alphaStr.endsWith('%') ? parseFloat(alphaStr) / 100 : parseFloat(alphaStr)
    if (!Number.isNaN(n) && n === 0) return true
  }
  return false
}

function checkDeclaration(decl: Declaration, lead: LeadTarget | null, errors: string[]) {
  const prop = decl.prop.toLowerCase()
  const value = decl.value.trim().toLowerCase()
  const inKeyframes = hasAncestor(decl, isKeyframes)

  if (prop === 'behavior' || prop === '-moz-binding') errors.push(`${prop} is not allowed.`)
  if (/expression\(|javascript:/.test(value)) errors.push(`${prop}: ${decl.value} is not allowed.`)
  if (prop === 'display' && value === 'none') errors.push('display: none is not allowed (it hides content).')
  if (prop === 'visibility' && (value === 'hidden' || value === 'collapse')) errors.push(`visibility: ${value} is not allowed.`)
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
  if (prop === 'position' && (value === 'fixed' || value === 'sticky')) {
    const navbar = lead?.kind === 'component' && lead.id === 'navbar'
    if (!navbar) errors.push(`position: ${value} is not allowed outside the navbar.`)
  }
  if (prop === 'color' || prop === '-webkit-text-fill-color') {
    if (value === 'transparent' || hasZeroAlpha(value)) {
      errors.push(`${prop}: ${decl.value} is not allowed (it hides text).`)
    }
  }
  if (prop === 'font-size') {
    if (/calc\(/.test(value)) {
      errors.push(`font-size: ${decl.value} is not allowed (calc() cannot be evaluated statically).`)
    } else if (/^[\d.]+$/.test(value)) {
      errors.push(`font-size: ${decl.value} is not allowed (unitless font sizes are not allowed).`)
    } else {
      const mUnit = /^([\d.]+)(px|rem|em)$/.exec(value)
      const mPct = /^([\d.]+)%$/.exec(value)
      if (mUnit) {
        const n = parseFloat(mUnit[1])
        if ((mUnit[2] === 'px' && n < 12) || (mUnit[2] !== 'px' && n < 0.75)) {
          errors.push(`font-size: ${decl.value} is too small (min 12px / 0.75rem).`)
        }
      } else if (mPct) {
        if (parseFloat(mPct[1]) < 75) errors.push(`font-size: ${decl.value} is too small (min 75%).`)
      }
      // else: var()/clamp()/keyword — allowed, can't statically evaluate.
    }
  }
  if (prop === 'z-index') {
    const n = parseInt(value, 10)
    if (!Number.isNaN(n) && n > 50) errors.push(`z-index: ${decl.value} is too high (max 50).`)
  }
  if (prop === 'pointer-events' && value === 'none') errors.push('pointer-events: none is not allowed.')
  if ((prop === 'animation' || prop === 'animation-fill-mode') && /\b(?:forwards|both)\b/.test(value)) {
    errors.push(`${prop}: ${decl.value} may not use the forwards/both fill mode (can hide content permanently).`)
  }
  if ((prop === 'animation' || prop === 'animation-name') && value !== 'none' && !hasAncestor(decl, isReducedMotionGate)) {
    errors.push('animations must sit inside @media (prefers-reduced-motion: no-preference).')
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

    if (hasAncestor(rule, isRootRule)) {
      errors.push(`Selector "${rule.selector}" may not nest a rule under :root.`)
      return
    }

    if (hasAncestor(rule, isRule)) {
      // A nested rule (e.g. `& h1`, `&:hover`) inherits its parent's target
      // scope via `&` — it doesn't need to (and can't) redeclare its own
      // [data-block]/[data-component] lead. The combinator/root-nesting bans
      // above still apply to it.
      return
    }

    parsed.each((sel) => {
      const lead = leadingTarget(sel)
      if (!lead || !targetAllowed(lead, scope)) {
        const where = scope.kind === 'target' ? `[${attrNameFor(scope.target)}="${scope.target}"]` : 'a known [data-block] / [data-component] / :root'
        errors.push(`Selector "${sel.toString().trim()}" must be scoped to ${where}.`)
        return
      }
      rule.walkDecls((decl) => {
        if (lead.kind === 'root' && decl.parent === rule) {
          const prop = decl.prop.toLowerCase()
          if (!prop.startsWith('--')) errors.push(`:root may only set custom properties (got ${decl.prop}).`)
          else if (!ROOT_PROP_PREFIXES.some((p) => prop.startsWith(p))) {
            errors.push(`:root may not set ${decl.prop} (allowed prefixes: ${ROOT_PROP_PREFIXES.join(', ')}).`)
          }
        }
      })
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
    // Find the outermost rule (through any nesting/at-rule wrapping) to learn
    // which target this decl styles.
    let top: ChildNode = decl.parent as Rule
    while (top.parent && top.parent.type !== 'root') top = top.parent as ChildNode
    let lead: LeadTarget | null = null
    const outer = top.type === 'rule' ? (top as Rule) : null
    const ownerRule = outer ?? (decl.parent as Rule)
    try {
      const first = selectorParser().astSync(ownerRule.selector).first
      lead = first ? leadingTarget(first) : null
    } catch {
      lead = null
    }
    checkDeclaration(decl, lead, errors)
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
