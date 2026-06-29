// Shared recharts colors, sourced from palette CSS variables so charts match
// the design tokens (design rule 1 — no hardcoded hex). Plain constants, safe
// to import from any client chart component.
import type { SemanticToken } from '@/lib/audit/report-format'

export const TOKEN_VAR: Record<SemanticToken, string> = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
  muted: 'var(--color-text-muted)',
}

export const BRAND = {
  cyan: 'var(--color-brand-cyan)',
  navy: 'var(--color-brand-navy)',
  border: 'var(--color-border-default)',
  surfaceSubtle: 'var(--color-surface-subtle)',
  textMuted: 'var(--color-text-muted)',
  textSecondary: 'var(--color-text-secondary)',
}

// Categorical palette for series that aren't grade-colored (models, clients,
// content formats, phases). Brand-led, then supporting palette hues.
export const SERIES = [
  'var(--color-brand-cyan)',
  'var(--color-brand-navy)',
  'var(--color-brand-purple)',
  'var(--color-warning)',
  'var(--color-success)',
  'var(--color-brand-cyan-dark)',
  'var(--color-text-muted)',
]

export const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: '1px solid var(--color-border-default)',
} as const
