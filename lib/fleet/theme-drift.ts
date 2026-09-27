import { generateThemeCss } from '@/lib/content/theme-css-generator'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'

// Fleet-level theme.css drift, split by SEVERITY (pure). The Studio's
// isThemeCssStale is byte equality, so "your palette never shipped" and "a newer
// additive token is missing" look identical there (R4 F3). Here:
//   in-sync   — byte-identical to generateThemeCss(brand, design)
//   additive  — every token the file has matches; it only lacks generator-added
//               tokens the template reads with a fallback (--color-ink, the
//               action-text set) or differs only in those
//   palette   — at least one core token (--color-primary / -action / surfaces…)
//               differs → the live site doesn't show the saved palette
//   other     — same tokens, different bytes (comments/formatting)
//   missing   — no theme.css;  unknown — brand/design missing or unparseable

export type ThemeCssState = 'in-sync' | 'additive' | 'palette' | 'other' | 'missing' | 'unknown'

// Tokens the generator added after sites were first deployed; the template
// reads each with a fallback, so their absence is cosmetic, not a wrong palette.
export const ADDITIVE_TOKENS = new Set([
  '--color-ink',
  '--color-ink-foreground',
  '--color-action-text',
  '--color-action-text-canvas',
  '--color-action-text-tint',
  '--color-action-on-primary',
  '--color-action-on-ink',
])

export interface ThemeCssDrift {
  state: ThemeCssState
  /** scope:token for core tokens whose value differs (scope = light | dark). */
  paletteDiffs: string[]
  /** scope:token present in the generated file but absent from the committed one. */
  missing: string[]
  committedAction: string | null
  brandAction: string | null
}

const DARK_BLOCK = /^\.dark\s*\{[\s\S]*?^\}/m

export function tokenMap(css: string): Map<string, string> {
  const out = new Map<string, string>()
  const dark = css.match(DARK_BLOCK)
  const light = dark && dark.index !== undefined ? css.slice(0, dark.index) + css.slice(dark.index + dark[0].length) : css
  const collect = (text: string, scope: string) => {
    for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
      const key = `${scope}:${m[1]}`
      if (!out.has(key)) out.set(key, m[2].trim().replace(/\s+/g, ' ').toLowerCase())
    }
  }
  collect(light, 'light')
  if (dark) collect(dark[0], 'dark')
  return out
}

export function classifyThemeCss(committed: string | null, brandText: string | null, designText: string | null): ThemeCssDrift {
  let brand: BrandJson | null = null
  let design: DesignJson | null = null
  try {
    brand = brandText ? (JSON.parse(brandText) as BrandJson) : null
    design = designText ? (JSON.parse(designText) as DesignJson) : null
  } catch {
    brand = null
  }
  const brandAction = brand?.palette?.action ?? null
  const committedAction = committed ? (tokenMap(committed).get('light:--color-action') ?? null) : null
  const base = { paletteDiffs: [], missing: [], committedAction, brandAction }
  if (committed === null) return { ...base, state: 'missing' }
  if (!brand || !design) return { ...base, state: 'unknown' }
  let generated: string
  try {
    generated = generateThemeCss(brand, design)
  } catch {
    return { ...base, state: 'unknown' }
  }
  if (generated === committed) return { ...base, state: 'in-sync' }

  const want = tokenMap(generated)
  const have = tokenMap(committed)
  const paletteDiffs: string[] = []
  const missing: string[] = []
  for (const [key, value] of want) {
    const name = key.slice(key.indexOf(':') + 1)
    const cur = have.get(key)
    if (cur === undefined) missing.push(key)
    else if (cur !== value && !ADDITIVE_TOKENS.has(name)) paletteDiffs.push(key)
  }
  const additiveDiff = [...want].some(([key, value]) => {
    const name = key.slice(key.indexOf(':') + 1)
    return ADDITIVE_TOKENS.has(name) && have.has(key) && have.get(key) !== value
  })
  const coreMissing = missing.filter((k) => !ADDITIVE_TOKENS.has(k.slice(k.indexOf(':') + 1)))
  const state: ThemeCssState =
    paletteDiffs.length || coreMissing.length ? 'palette' : missing.length || additiveDiff ? 'additive' : 'other'
  return { state, paletteDiffs, missing, committedAction, brandAction }
}
