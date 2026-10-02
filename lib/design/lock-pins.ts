// Pure. Freezing a locked area's look: at lock time every theme custom property
// that reaches a block (theme.css colours / spacing / radius / shadows, the
// template's type-scale defaults, the global fragment's :root overrides) and
// the three font families are captured (snapshotLook). composeLockPins then
// re-declares them on the target, so site-wide changes made later stop at it.
//
// Pins are wrapped in :where() (zero specificity) and written FIRST in the
// design-studio region: any rule authored for the block itself still wins,
// while inherited values from :root never do. Fonts reference a
// --font-pin-<slug> variable the fonts module loads (pinnedFonts below), with
// the family name as the fallback for sites whose fonts come from
// googleFontsUrl.
import { fontPinVariable } from '@/lib/content/font-module-generator'
import type { CssTarget } from './css-targets'
import { CHROME_COMPONENTS } from './css-targets'
import type { DesignLock, LockSnapshot } from './locks'

// The template's globals.css :root design-scale defaults (template
// 2026.09.11). A snapshot always carries them so a LATER global :root
// override (e.g. --type-h2) can't reach a block locked before it existed.
export const TEMPLATE_SCALE_DEFAULTS: Readonly<Record<string, string>> = {
  '--type-display': 'clamp(2.6rem, 1.4rem + 4.2vw, 4.25rem)',
  '--type-h1': 'clamp(2rem, 1.3rem + 2.4vw, 3rem)',
  '--type-h2': 'clamp(1.6rem, 1.15rem + 1.5vw, 2.25rem)',
  '--type-h3': '1.375rem',
  '--type-h4': '1.125rem',
  '--type-body-lg': '1.125rem',
  '--type-body': '1rem',
  '--type-small': '0.875rem',
  '--type-caption': '0.75rem',
  '--tracking-display': '-0.025em',
  '--tracking-tight': '-0.015em',
  '--duration-base': '200ms',
  '--overlay-soft': '0.4',
  '--overlay-medium': '0.62',
}

const VAR_NAME = /^--[a-z0-9-]{1,64}$/
// A pinned value never carries anything that could end the declaration/rule.
const SAFE_VALUE = /^[^;{}<>\\]{1,200}$/
// Font roles are re-declared from the snapshot's families, never copied.
const FONT_VARS = new Set(['--font-heading', '--font-body', '--font-accent', '--font-display', '--font-mono'])

function blockBody(css: string, header: RegExp): string | null {
  const m = header.exec(css)
  if (!m) return null
  const start = m.index + m[0].length
  const end = css.indexOf('}', start)
  return end === -1 ? null : css.slice(start, end)
}

export function parseCustomProps(body: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!body) return out
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const decl of clean.split(';')) {
    const i = decl.indexOf(':')
    if (i === -1) continue
    const name = decl.slice(0, i).trim()
    const value = decl.slice(i + 1).trim()
    if (VAR_NAME.test(name) && SAFE_VALUE.test(value) && !FONT_VARS.has(name)) out[name] = value
  }
  return out
}

export type LookSource = {
  themeCss: string
  globalCss: string | undefined
  typography: { headingFont: string; bodyFont: string; accentFont: string }
  headlineStyle: 'sans' | 'serif'
}

export function snapshotLook(src: LookSource): LockSnapshot {
  const theme = parseCustomProps(blockBody(src.themeCss, /@theme\s*\{/))
  const root = parseCustomProps(blockBody(src.themeCss, /(^|\n):root\s*\{/))
  const globalRoot = parseCustomProps(blockBody(src.globalCss ?? '', /(^|\n|\})\s*:root\s*\{/))
  return {
    vars: { ...TEMPLATE_SCALE_DEFAULTS, ...theme, ...root, ...globalRoot },
    darkVars: parseCustomProps(blockBody(src.themeCss, /(^|\n)\.dark\s*\{/)),
    fonts: {
      heading: src.typography.headingFont,
      body: src.typography.bodyFont,
      accent: src.typography.accentFont,
      display: src.headlineStyle === 'serif' ? 'accent' : 'heading',
    },
  }
}

const SANS = 'system-ui, sans-serif'
const SERIF = 'Georgia, "Times New Roman", serif'
const FAMILY_SAFE = /^[A-Za-z0-9 ]{1,60}$/

const isFamily = (f: unknown): f is string => typeof f === 'string' && FAMILY_SAFE.test(f)

function fontStack(family: unknown, generic: string): string | null {
  if (!isFamily(family)) return null
  return `var(${fontPinVariable(family)}, "${family}"), ${generic}`
}

function selectorFor(target: CssTarget): string {
  const attr = (CHROME_COMPONENTS as readonly string[]).includes(target) ? 'data-component' : 'data-block'
  return `[${attr}="${target}"]`
}

function declarations(vars: Record<string, string>): string[] {
  return Object.entries(vars)
    .filter(([name, value]) => VAR_NAME.test(name) && SAFE_VALUE.test(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `  ${name}: ${value};`)
}

type AreaLock = Extract<DesignLock, { kind: 'area' }> & { snapshot: LockSnapshot }

function areaLocks(locks: readonly DesignLock[]): AreaLock[] {
  return locks
    .filter((l): l is AreaLock => l.kind === 'area' && l.snapshot !== null)
    .sort((a, b) => a.key.localeCompare(b.key))
}

// The `locks` fragment of the design-studio region ('' when nothing is pinned).
export function composeLockPins(locks: readonly DesignLock[]): string {
  const rules: string[] = []
  for (const lock of areaLocks(locks)) {
    const sel = selectorFor(lock.key)
    const { fonts } = lock.snapshot
    const heading = fontStack(fonts.heading, SANS)
    const accent = fontStack(fonts.accent, SERIF)
    const stacks: [string, string | null][] = [
      ['--font-heading', heading],
      ['--font-body', fontStack(fonts.body, SANS)],
      ['--font-accent', accent],
      ['--font-display', fonts.display === 'accent' ? accent : heading],
    ]
    const fontDecls = stacks.filter((s): s is [string, string] => s[1] !== null).map(([name, stack]) => `  ${name}: ${stack};`)
    rules.push(`:where(${sel}) {\n${[...declarations(lock.snapshot.vars), ...fontDecls].join('\n')}\n}`)
    const dark = declarations(lock.snapshot.darkVars)
    if (dark.length > 0) rules.push(`:where(.dark ${sel}) {\n${dark.join('\n')}\n}`)
  }
  return rules.join('\n')
}

// Every family a pin references — the fonts module (and googleFontsUrl) must
// keep loading them after the site-wide fonts move on.
export function pinnedFontsOf(locks: readonly DesignLock[]): string[] {
  const out = new Set<string>()
  for (const lock of areaLocks(locks)) {
    for (const f of [lock.snapshot.fonts.heading, lock.snapshot.fonts.body, lock.snapshot.fonts.accent]) {
      if (isFamily(f)) out.add(f)
    }
  }
  return [...out].sort()
}

export function parseLockSnapshot(value: unknown): LockSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const record = (x: unknown): Record<string, string> | null => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null
    const out: Record<string, string> = {}
    for (const [k, val] of Object.entries(x)) if (typeof val === 'string') out[k] = val
    return out
  }
  const vars = record(v.vars)
  const darkVars = record(v.darkVars)
  const f = v.fonts as Record<string, unknown> | undefined
  if (!vars || !darkVars || !f || typeof f !== 'object') return null
  const { heading, body, accent, display } = f
  if (typeof heading !== 'string' || typeof body !== 'string' || typeof accent !== 'string') return null
  return { vars, darkVars, fonts: { heading, body, accent, display: display === 'accent' ? 'accent' : 'heading' } }
}

const PIN_RULE_OPEN = /^:where\((\.dark )?\[data-(block|component)="[a-z0-9-]{1,64}"\]\) \{$/
const PIN_DECL = /^ {2}(--[a-z0-9-]{1,64}): ([^;{}<>\\]{1,200});$/

// Structural gate for a `locks` fragment read back from a file or a stored
// bundle: only the exact shape composeLockPins writes — :where(target) rules
// of custom-property declarations. Anything else is refused, never written.
export function isWellFormedLockPins(css: string): boolean {
  const lines = css.replace(/\r\n/g, '\n').trim().split('\n')
  if (lines.length === 1 && lines[0] === '') return true
  let open = false
  for (const line of lines) {
    if (!open) {
      if (!PIN_RULE_OPEN.test(line)) return false
      open = true
    } else if (line === '}') {
      open = false
    } else if (!PIN_DECL.test(line)) {
      return false
    }
  }
  return !open
}
