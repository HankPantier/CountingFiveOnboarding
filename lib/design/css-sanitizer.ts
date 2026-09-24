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
import postcss, { type AtRule, type ChildNode, type Container, type Declaration, type Node, type Root, type Rule } from 'postcss'
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
    return t.id === scope.target
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
const isReducedMotionGate = (n: Container): boolean =>
  n.type === 'atrule' &&
  (n as AtRule).name.toLowerCase() === 'media' &&
  /prefers-reduced-motion\s*:\s*no-preference/i.test((n as AtRule).params)

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

function checkDeclaration(decl: Declaration, lead: LeadTarget | null, errors: string[]) {
  const prop = decl.prop.toLowerCase()
  const value = decl.value.trim().toLowerCase()
  const inKeyframes = hasAncestor(decl, isKeyframes)

  if (prop === 'behavior' || prop === '-moz-binding') errors.push(`${prop} is not allowed.`)
  if (/expression\(|javascript:/.test(value)) errors.push(`${prop}: ${decl.value} is not allowed.`)
  if (prop === 'display' && value === 'none') errors.push('display: none is not allowed (it hides content).')
  if (prop === 'visibility' && (value === 'hidden' || value === 'collapse')) errors.push(`visibility: ${value} is not allowed.`)
  if (prop === 'opacity' && !inKeyframes) {
    const n = value.endsWith('%') ? parseFloat(value) / 100 : parseFloat(value)
    if (!Number.isNaN(n) && n < 0.2) errors.push(`opacity: ${decl.value} is not allowed (below 0.2 hides content).`)
  }
  if (prop === 'content' && !['""', "''", 'none'].includes(value) && !value.startsWith('counter(')) {
    errors.push('content: text is not allowed (no injected copy).')
  }
  if (prop === 'position' && (value === 'fixed' || value === 'sticky')) {
    const navbar = lead?.kind === 'component' && lead.id === 'navbar'
    if (!navbar) errors.push(`position: ${value} is not allowed outside the navbar.`)
  }
  if ((prop === 'color' || prop === '-webkit-text-fill-color') && value === 'transparent') {
    errors.push(`${prop}: transparent is not allowed (it hides text).`)
  }
  if (prop === 'font-size') {
    const m = /^([\d.]+)(px|rem|em)$/.exec(value)
    if (m) {
      const n = parseFloat(m[1])
      if ((m[2] === 'px' && n < 12) || (m[2] !== 'px' && n < 0.75)) errors.push(`font-size: ${decl.value} is too small (min 12px / 0.75rem).`)
    }
  }
  if (prop === 'z-index') {
    const n = parseInt(value, 10)
    if (!Number.isNaN(n) && n > 50) errors.push(`z-index: ${decl.value} is too high (max 50).`)
  }
  if (prop === 'pointer-events' && value === 'none') errors.push('pointer-events: none is not allowed.')
  if ((prop === 'animation' || prop === 'animation-name') && !hasAncestor(decl, isReducedMotionGate)) {
    errors.push('animations must sit inside @media (prefers-reduced-motion: no-preference).')
  }
  if (value.includes('url(')) checkUrls(decl.value, errors)
}

export function sanitizeDesignCss(css: string, scope: CssScope): SanitizeResult {
  const input = css.trim()
  if (!input) return { ok: false, errors: ['The CSS is empty.'] }
  const maxBytes = scope.kind === 'global' ? MAX_GLOBAL_BYTES : MAX_TARGET_BYTES
  if (Buffer.byteLength(input, 'utf8') > maxBytes) return { ok: false, errors: [`The CSS is too large (max ${maxBytes} bytes).`] }
  if (/<\/|<script/i.test(input)) return { ok: false, errors: ['The CSS contains disallowed markup.'] }

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

  root.walkAtRules((at) => {
    const name = at.name.toLowerCase()
    if (!ALLOWED_AT_RULES.has(name)) {
      errors.push(`@${at.name} is not allowed (only @media, @supports, @container, and @keyframes c5-*).`)
      return
    }
    if (name === 'keyframes' && !/^c5-[a-z0-9-]+$/i.test(at.params.trim())) {
      errors.push(`@keyframes names must start with c5- (got "${at.params.trim()}").`)
    }
  })

  let important = 0
  root.walkRules((rule: Rule) => {
    // Keyframe steps (from/to/50%) and nested rules are covered by their parent.
    if (hasAncestor(rule, isKeyframes) || hasAncestor(rule, isRule)) return
    let parsed: selectorParser.Root
    try {
      parsed = selectorParser().astSync(rule.selector)
    } catch {
      errors.push(`Selector "${rule.selector}" does not parse.`)
      return
    }
    parsed.each((sel) => {
      const lead = leadingTarget(sel)
      if (!lead || !targetAllowed(lead, scope)) {
        const where = scope.kind === 'target' ? `[data-block="${scope.target}"] / [data-component="${scope.target}"]` : 'a known [data-block] / [data-component] / :root'
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

  root.walkDecls((decl) => {
    if (decl.important) important++
    if (decl.parent?.type !== 'rule') {
      errors.push(`Declaration "${decl.prop}" must be inside a rule.`)
      return
    }
    // Find the outermost rule (nesting) to learn which target this decl styles.
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

  if (errors.length === 0) {
    try {
      transform({ filename: 'design-overrides.css', code: Buffer.from(out), errorRecovery: false })
    } catch (err) {
      errors.push(`The CSS does not parse in LightningCSS: ${err instanceof Error ? err.message : 'unknown error'}.`)
    }
  }

  return errors.length ? { ok: false, errors: Array.from(new Set(errors)) } : { ok: true, css: out }
}
