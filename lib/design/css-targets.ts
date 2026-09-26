// Pure, client-safe vocabulary of what design CSS may target. Shared by the
// sanitizer (server) and the DesignBundle schema (client-safe).
import { OVERRIDE_BLOCKS } from '@/lib/editor/theme-edit'
import { STYLE_AXIS_ATTRIBUTES } from './style-axes'

// Site chrome the template marks with data-component (navbar, footer, cookie
// consent) — styleable like a block.
export const CHROME_COMPONENTS = ['navbar', 'footer', 'cookie-consent'] as const

export const CSS_TARGETS = [...OVERRIDE_BLOCKS, ...CHROME_COMPONENTS] as const
export type CssTarget = (typeof CSS_TARGETS)[number]

export function isCssTarget(s: string): s is CssTarget {
  return (CSS_TARGETS as readonly string[]).includes(s)
}

// <html> state attributes the template sets from design.json. CSS may key off
// them (html[data-headline="serif"] [data-block="hero"] …). The treatment pair
// is what the brief's byte-stable CSS rules list; the style-axis attributes
// (T2) are advertised in the tier-dependent levers section instead.
export const TREATMENT_STATE_ATTRS: readonly string[] = ['data-headline', 'data-eyebrow']
export const HTML_STATE_ATTRS: readonly string[] = [...TREATMENT_STATE_ATTRS, ...STYLE_AXIS_ATTRIBUTES]
