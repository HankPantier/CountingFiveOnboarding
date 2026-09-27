// The Design System (palette + design tokens) is a HARD gate on the content
// pipeline. Before this gate, 8 of 10 live sites reached phase 6 without ever
// locking a palette: the sitemap confirm jumped phase 1 → 3 and packaging
// silently shipped FALLBACK_PALETTE (generic slate/teal) — the main reason the
// fleet looked unbranded. Pure + client-safe (PhaseStepper imports it).

import { FALLBACK_PALETTE } from './deliverable-defaults'

// #rgb, #rrggbb, or #rrggbbaa — the forms chroma-js and the theme generator accept.
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const PALETTE_ROLES = ['primary', 'secondary', 'complementary', 'action', 'nearBlack', 'nearWhite'] as const

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** True when the value is a complete six-role palette of hex swatches. */
export function isCompletePalette(palette: unknown): boolean {
  if (!isObject(palette)) return false
  return PALETTE_ROLES.every((role) => {
    const swatch = palette[role]
    return isObject(swatch) && typeof swatch.hex === 'string' && HEX_RE.test(swatch.hex)
  })
}

/**
 * The six-role palette from a content/brand.json text (roles as hex strings),
 * in PaletteData form, or null when the file is unparseable or incomplete.
 * brand.json is the LIVE palette: Theme Studio and Design Studio write it.
 * The generic FALLBACK_PALETTE counts as no palette.
 */
export function paletteFromBrandJson(text: string | null | undefined): Record<(typeof PALETTE_ROLES)[number], { hex: string; name: string }> | null {
  if (!text) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const pal = isObject(raw) ? raw.palette : null
  if (!isObject(pal)) return null
  const out = Object.fromEntries(
    PALETTE_ROLES.map((role) => [role, { hex: typeof pal[role] === 'string' ? (pal[role] as string) : '', name: role }])
  ) as Record<(typeof PALETTE_ROLES)[number], { hex: string; name: string }>
  if (!isCompletePalette(out)) return null
  // The pre-gate packager shipped FALLBACK_PALETTE into brand.json on the
  // unbranded sites: that is not a locked palette, so the caller falls through
  // to the job palette (and the 409 when that is missing too).
  const isFallback = PALETTE_ROLES.every((role) => out[role].hex.toLowerCase() === FALLBACK_PALETTE[role].hex.toLowerCase())
  return isFallback ? null : out
}

/** True when the value carries a type pairing (the one field every consumer needs). */
export function isCompleteDesignTokens(tokens: unknown): boolean {
  if (!isObject(tokens) || !isObject(tokens.typePairing)) return false
  const { headingFont, bodyFont } = tokens.typePairing
  return typeof headingFont === 'string' && !!headingFont && typeof bodyFont === 'string' && !!bodyFont
}

/** A content job's Design System is locked when both palette and tokens are saved. */
export function isDesignSystemLocked(job: { palette: unknown; design_tokens: unknown }): boolean {
  return isCompletePalette(job.palette) && isCompleteDesignTokens(job.design_tokens)
}

export const DESIGN_SYSTEM_REQUIRED_FOR_SITEMAP =
  'Lock the Design System (step 1: palette + type) before confirming the sitemap.'

export const DESIGN_SYSTEM_REQUIRED_FOR_PACKAGE =
  'This site has no locked Design System (palette + type), so it would ship the generic fallback colours. Open step 1 “Design System”, review the logo palette and click Save, then package again.'

// Re-deploy of a live site: brand.json / design.json / theme.css are site
// config a re-deploy never overwrites, so locking step 1 does not change the
// live colours — only Theme Studio or Design Studio does.
export const DESIGN_SYSTEM_REQUIRED_FOR_REDEPLOY =
  'Packaging needs a locked Design System (palette + type): open step 1 “Design System”, review the logo palette and click Save, then package again. This site is already live, so saving step 1 does not change its colours; use Theme Studio or Design Studio for that.'

export const DESIGN_SYSTEM_REQUIRED_FOR_EXPORT =
  'This site has no locked palette, so the export would use generic colours. Open step 1 “Design System” on the content job, review the logo palette and click Save, then export again.'

// Editor / Site Owner members can't open the content job (manager-only).
export const DESIGN_SYSTEM_REQUIRED_FOR_EXPORT_MEMBER =
  'This site has no locked palette, so the export would use generic colours. Ask an admin or manager to lock the Design System (step 1 on the content job), then export again.'

export type PhaseStatusValue = 'locked' | 'active' | 'complete'

/**
 * Stepper status for one phase card. The card after the current phase is
 * normally live too (look-ahead), EXCEPT the sitemap while the Design System is
 * unlocked; and the Design System card stays active on any job that reached a
 * later phase without locking it, so the operator can still lock it there.
 */
export function getPhaseStatus(jobPhase: number, thisPhase: number, designLocked = true): PhaseStatusValue {
  if (thisPhase === 1 && !designLocked) return 'active'
  if (thisPhase < jobPhase) return 'complete'
  if (thisPhase === jobPhase) return 'active'
  if (thisPhase === jobPhase + 1) return thisPhase === 2 && !designLocked ? 'locked' : 'active'
  return 'locked'
}
