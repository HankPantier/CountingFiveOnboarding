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

// Compact per-page summary for the generation-status poll. Coerces a stored
// value defensively (older/partial rows → null).
export function summarizeCritic(raw: unknown): { overall: number; hasFlags: boolean } | null {
  const parsed = parseCritic(raw)
  if (!parsed) return null
  return { overall: criticOverall(parsed), hasFlags: parsed.unsupported_claims.length > 0 }
}
