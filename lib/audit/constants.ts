// Scoring weights, grade scale, and recommended security headers.
// Ported 1:1 from audit.py (SCORING_WEIGHTS, GRADE_SCALE, SEC_HEADER_RECOMMENDED).
// Per-category check thresholds are kept inline in scoring.ts / analyze-page.ts
// to mirror audit.py exactly and avoid transcription drift.
import type { CategoryKey, Grade } from './types'

// Local SEO is a first-class category: CPA firms are local-intent, so local
// signals (LocalBusiness/AccountingService JSON-LD, NAP, geo, hours, maps)
// weigh into the overall grade. Funded by taking 0.05 each from performance and
// technical so the weights still sum to 1.0.
export const SCORING_WEIGHTS = {
  performance: 0.15,
  technical: 0.1,
  onpage_seo: 0.15,
  ux: 0.1,
  content: 0.1,
  indexability: 0.1,
  schema: 0.1,
  ai_llm: 0.05,
  analytics: 0.05,
  local_seo: 0.1,
} as const satisfies Record<CategoryKey, number>

/** [minScore, grade, label] in descending threshold order. */
export const GRADE_SCALE: ReadonlyArray<readonly [number, Grade, string]> = [
  [90, 'A', 'Excellent'],
  [80, 'B', 'Good'],
  [70, 'C', 'Needs Work'],
  [60, 'D', 'Poor'],
  [0, 'F', 'Critical Issues'],
]

/** Recommended security headers (name → recommended value). Order matters:
 * `missing_security_headers` and `sec_headers` iterate these keys. */
export const SEC_HEADER_RECOMMENDED: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline';",
  'x-frame-options': 'SAMEORIGIN',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}

export const SEC_HEADER_NAMES = Object.keys(SEC_HEADER_RECOMMENDED)
