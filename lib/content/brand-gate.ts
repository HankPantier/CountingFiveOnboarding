// The Design System (palette + design tokens) is a HARD gate on the content
// pipeline. Before this gate, 8 of 10 live sites reached phase 6 without ever
// locking a palette: the sitemap confirm jumped phase 1 → 3 and packaging
// silently shipped FALLBACK_PALETTE (generic slate/teal) — the main reason the
// fleet looked unbranded. Pure + client-safe (PhaseStepper imports it).

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/
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
