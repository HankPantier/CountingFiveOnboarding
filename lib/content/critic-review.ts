// Pure types + parsing/summarizing for the advisory draft-gate critic. NO
// server-only imports here so this module is safe to pull into client bundles
// (the preview modal renders a CriticReview; the status route summarizes one).
// The server-side generator lives in ./draft-critic (createServerClient + AI).

// The advisory quality score stored on generated_pages.critic_review. Written in
// the background after a page completes; never gates approval or publishing.
export type CriticReview = {
  evidence_specificity: number // 0-10 — concrete facts/numbers vs vague filler
  information_gain: number // 0-10 — unique value vs the competitor reference
  brand_fidelity: number // 0-10 — matches the firm's voice + positioning
  promise_fulfillment: number // 0-10 — delivers what the approved outline promised
  unsupported_claims: string[] // verbatim specifics not grounded in the firm profile
  notes: string // 1-3 sentence admin-readable summary
  critic_model: string
  scored_at: string // ISO
  // Auto-remediation bookkeeping (stored in the same JSON — no extra column).
  // The critic auto-regenerates a weak page once, then flags whatever remains for
  // a human. Older rows omit these; treat absent as false/0.
  needs_human_review?: boolean // still weak after the auto-regen budget was spent
  regenerated?: boolean // the critic triggered a targeted regeneration of this page
  critic_regen_attempts?: number // how many critic-driven regenerations have run (cap 1)
}

// The model-provided portion (critic_model + scored_at are stamped server-side).
export type ParsedCritic = Omit<CriticReview, 'critic_model' | 'scored_at'>

const SCORE_KEYS = [
  'evidence_specificity',
  'information_gain',
  'brand_fidelity',
  'promise_fulfillment',
] as const

export function clampScore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(10, Math.round(n)))
}

// Parse a model answer OR a stored critic_review into ParsedCritic. Returns null
// when the four scores aren't all present as numbers — so a garbled/empty answer
// records nothing rather than a misleading all-zeros review.
export function parseCritic(parsed: unknown): ParsedCritic | null {
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  for (const k of SCORE_KEYS) {
    if (typeof p[k] !== 'number') return null
  }
  const claims = Array.isArray(p.unsupported_claims)
    ? p.unsupported_claims
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map(c => c.trim().slice(0, 300))
        .slice(0, 20)
    : []
  return {
    evidence_specificity: clampScore(p.evidence_specificity),
    information_gain: clampScore(p.information_gain),
    brand_fidelity: clampScore(p.brand_fidelity),
    promise_fulfillment: clampScore(p.promise_fulfillment),
    unsupported_claims: claims,
    notes: typeof p.notes === 'string' ? p.notes.trim().slice(0, 1000) : '',
  }
}

export function criticOverall(r: Pick<CriticReview, (typeof SCORE_KEYS)[number]>): number {
  return Math.round(
    (r.evidence_specificity + r.information_gain + r.brand_fidelity + r.promise_fulfillment) / 4,
  )
}

// A single dimension below this is "weak." One weak dimension alone is NOT enough
// to rewrite (a specific-but-imperfect page is normal); it takes two.
export const CRITIC_MIN_SCORE = 5
// Overall score below this → the whole draft is mediocre, worth one rewrite.
export const CRITIC_MIN_OVERALL = 6
// This many weak dimensions → worth one rewrite even if the average is okay.
export const CRITIC_WEAK_DIMS_FOR_REGEN = 2
// At most one critic-driven regeneration before flagging for a human. Kept here
// (not in the generator) so the pure decision logic is self-contained + testable.
export const MAX_CRITIC_REGEN = 1

// A page trips the auto-remediation threshold when the critic found a likely
// hallucination (any unsupported specific), OR the overall score is mediocre
// (< CRITIC_MIN_OVERALL), OR two-plus dimensions are weak. Deliberately NOT "any
// single dim < 5" — the critic flags specifics aggressively, so one low dimension
// on an otherwise-strong page shouldn't trigger a costly rewrite. Single source of
// truth for "this draft is weak."
export function criticFailsThreshold(
  r: Pick<CriticReview, (typeof SCORE_KEYS)[number] | 'unsupported_claims'>,
): boolean {
  if (r.unsupported_claims.length > 0) return true
  if (criticOverall(r) < CRITIC_MIN_OVERALL) return true
  return SCORE_KEYS.filter(k => r[k] < CRITIC_MIN_SCORE).length >= CRITIC_WEAK_DIMS_FOR_REGEN
}

// Pure decision for the auto-remediation orchestrator: accept a solid page,
// regenerate a weak one that still has budget, or flag a weak one that's out of
// budget. Isolated from the DB/generator so the branching is unit-testable.
export type CriticAction = 'accept' | 'regenerate' | 'flag'
export function decideCriticAction(
  review: Pick<CriticReview, (typeof SCORE_KEYS)[number] | 'unsupported_claims'>,
  priorAttempts: number,
): CriticAction {
  if (!criticFailsThreshold(review)) return 'accept'
  return priorAttempts >= MAX_CRITIC_REGEN ? 'flag' : 'regenerate'
}

// Turn a critic verdict into explicit "fix these" guidance for the regeneration
// prompt, so the rewrite is informed rather than a blind reroll.
export function buildCriticGuidance(
  r: Pick<CriticReview, 'unsupported_claims' | 'notes'>,
): string {
  const parts: string[] = []
  if (r.unsupported_claims.length) {
    parts.push(
      `Remove or ground these unsupported specifics — they read as fabricated. Keep one ONLY if it is in the firm profile above; otherwise cut it or rephrase it generically without the invented number/claim: ${r.unsupported_claims.join(' | ')}`,
    )
  }
  const notes = r.notes.trim()
  if (notes) parts.push(`Editor notes to address in the rewrite: ${notes}`)
  return parts.join('\n')
}

// How many critic-driven regenerations have already run for a stored review.
// Tolerant of legacy/absent/garbled values (→ 0).
export function readCriticRegenAttempts(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 0
  const n = (raw as Record<string, unknown>).critic_regen_attempts
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

// Compact per-page summary for the generation-status poll. Coerces a stored
// value defensively (older/partial rows → null). `needsReview` prefers the
// persisted flag (set after the auto-regen budget is spent) and falls back to
// the live threshold for legacy rows written before auto-remediation existed.
export function summarizeCritic(
  raw: unknown,
): { overall: number; hasFlags: boolean; needsReview: boolean; regenerated: boolean } | null {
  const parsed = parseCritic(raw)
  if (!parsed) return null
  const persistedFlag =
    raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>).needs_human_review
      : undefined
  const needsReview =
    typeof persistedFlag === 'boolean' ? persistedFlag : criticFailsThreshold(parsed)
  const regenerated =
    !!(raw && typeof raw === 'object' && (raw as Record<string, unknown>).regenerated)
  return {
    overall: criticOverall(parsed),
    hasFlags: parsed.unsupported_claims.length > 0,
    needsReview,
    regenerated,
  }
}
