// Heuristic client-health score (0–100). NOT persisted anywhere yet — it is
// derived from signals already present on the sessions row so the dashboard can
// surface clients that are stalling. Treat this as a v1 placeholder: swap in a
// real engagement signal when you have one, but KEEP the 0–100 range and the
// three tone bands so the UI (HealthRing) stays stable.
export interface HealthInput {
  current_phase: number
  last_activity_at: string
  reminder_count?: number | null
}

export function clientHealth({ current_phase, last_activity_at, reminder_count }: HealthInput): number {
  // Progress through the 7-phase intake — further along reads as healthier.
  const progress = Math.max(0, Math.min(7, current_phase)) / 7 // 0..1
  // Recency — fresh activity is good; decays to 0 by ~10 idle days.
  const days = Math.max(0, (Date.now() - new Date(last_activity_at).getTime()) / 86_400_000)
  const recency = Math.max(0, 1 - days / 10) // 0..1
  // Reminders sent without a response drag the score down.
  const penalty = Math.min(0.25, (reminder_count ?? 0) * 0.08)

  const score = (progress * 0.55 + recency * 0.45 - penalty) * 100
  return Math.max(0, Math.min(100, Math.round(score)))
}

export type HealthTone = 'good' | 'warn' | 'risk'

export function healthTone(score: number): HealthTone {
  if (score >= 80) return 'good'
  if (score >= 60) return 'warn'
  return 'risk'
}
