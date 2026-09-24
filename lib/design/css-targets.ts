// Pure, client-safe vocabulary of what design CSS may target. Shared by the
// sanitizer (server) and the DesignBundle schema (client-safe).
import { OVERRIDE_BLOCKS } from '@/lib/editor/theme-edit'

// Site chrome the template marks with data-component (navbar, footer, cookie
// consent) — styleable like a block.
export const CHROME_COMPONENTS = ['navbar', 'footer', 'cookie-consent'] as const

export const CSS_TARGETS = [...OVERRIDE_BLOCKS, ...CHROME_COMPONENTS] as const
export type CssTarget = (typeof CSS_TARGETS)[number]

export function isCssTarget(s: string): s is CssTarget {
  return (CSS_TARGETS as readonly string[]).includes(s)
}

// <html> state attributes the template sets from design.json. CSS may key off
// them (html[data-headline="serif"] [data-block="hero"] …). P6b adds style axes.
export const HTML_STATE_ATTRS: readonly string[] = ['data-headline', 'data-eyebrow']
