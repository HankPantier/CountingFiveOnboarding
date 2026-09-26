// Pure + client-safe. The Design Studio critic's rubric (spec P4): six
// dimensions scored 1–5, and the pass rule — every score ≥ 3, mean ≥ 3.8, and
// distinctiveness ≥ 3 when the run's palette freedom is keep / evolve (the
// palette is held or nudged, so the system can only move so far) or ≥ 4 when
// it is free (P7 judge rework, 2026-09-26). `passed` is ALWAYS computed here
// from the scores + the palette freedom the critique was made under; the
// model's own verdict (and any stored flag) is never trusted.
import { z } from 'zod'
import type { PaletteFreedom } from './run-types'
import { PALETTE_FREEDOMS } from './studio-types'

export const RUBRIC_KEYS = ['brandFit', 'distinctiveness', 'hierarchy', 'legibility', 'consistency', 'craft'] as const
export type RubricKey = (typeof RUBRIC_KEYS)[number]
export const RUBRIC_LABELS: Record<RubricKey, string> = {
  brandFit: 'Brand fit',
  distinctiveness: 'Distinctiveness',
  hierarchy: 'Hierarchy',
  legibility: 'Legibility',
  consistency: 'Consistency',
  craft: 'Craft',
}
export const PASS_MIN_SCORE = 3
export const PASS_MIN_MEAN = 3.8
// Distinctiveness bar by palette freedom: free ⇒ 4, keep / evolve ⇒ 3.
export const PASS_MIN_DISTINCTIVENESS_FREE = 4
export const PASS_MIN_DISTINCTIVENESS_HELD = 3
// Records stored before the palette freedom was recorded were judged at the
// free bar (≥ 4) — re-deriving them at that bar keeps their verdict stable.
export const LEGACY_CRITIQUE_PALETTE_FREEDOM: PaletteFreedom = 'free'
export const MAX_CRITIQUE_ISSUES = 6

export type RubricScores = Record<RubricKey, number>
export type CritiqueIssue = { area: string; problem: string; fix: string }
export type CritiqueRecord = {
  iteration: number // the bundle iteration critiqued (0 = as first designed)
  scores: RubricScores
  reasons: Record<RubricKey, string>
  issues: CritiqueIssue[]
  summary: string
  passed: boolean // server-computed
  mean: number // 2 decimals, display only
  paletteFreedom: PaletteFreedom // the run's palette freedom — sets the distinctiveness bar
  model: string
  at: string
}

export function minDistinctivenessFor(freedom: PaletteFreedom): number {
  return freedom === 'free' ? PASS_MIN_DISTINCTIVENESS_FREE : PASS_MIN_DISTINCTIVENESS_HELD
}

export function minScoreFor(key: RubricKey, freedom: PaletteFreedom): number {
  return key === 'distinctiveness' ? minDistinctivenessFor(freedom) : PASS_MIN_SCORE
}

const exactMean = (scores: RubricScores): number => RUBRIC_KEYS.reduce((sum, k) => sum + scores[k], 0) / RUBRIC_KEYS.length

export function rubricMean(scores: RubricScores): number {
  return Math.round(exactMean(scores) * 100) / 100
}

export function critiquePasses(scores: RubricScores, freedom: PaletteFreedom): boolean {
  return RUBRIC_KEYS.every((k) => scores[k] >= minScoreFor(k, freedom)) && exactMean(scores) >= PASS_MIN_MEAN
}

const clip = (max: number) => (s: string) => s.trim().slice(0, max)
const score = z.number().min(1).max(5).transform((n) => Math.round(n))
const reason = z.string().transform(clip(300)).default('')
const AnswerSchema = z.object({
  scores: z.object({ brandFit: score, distinctiveness: score, hierarchy: score, legibility: score, consistency: score, craft: score }),
  reasons: z
    .object({ brandFit: reason, distinctiveness: reason, hierarchy: reason, legibility: reason, consistency: reason, craft: reason })
    .default({ brandFit: '', distinctiveness: '', hierarchy: '', legibility: '', consistency: '', craft: '' }),
  issues: z
    .array(z.object({ area: z.string().transform(clip(80)), problem: z.string().transform(clip(300)), fix: z.string().transform(clip(300)) }))
    .default([])
    .transform((list) => list.slice(0, MAX_CRITIQUE_ISSUES)),
  summary: z.string().transform(clip(600)).default(''),
})
const StoredSchema = AnswerSchema.extend({
  iteration: z.number().int().min(0),
  model: z.string().max(80),
  at: z.string().max(40),
  paletteFreedom: z.enum(PALETTE_FREEDOMS).default(LEGACY_CRITIQUE_PALETTE_FREEDOM),
})

export type CritiqueMeta = { iteration: number; model: string; at: string; paletteFreedom: PaletteFreedom }

function toRecord(a: z.infer<typeof AnswerSchema>, meta: CritiqueMeta): CritiqueRecord {
  return { ...a, ...meta, passed: critiquePasses(a.scores, meta.paletteFreedom), mean: rubricMean(a.scores) }
}

export function parseCritiqueAnswer(
  raw: unknown,
  meta: CritiqueMeta
): { ok: true; record: CritiqueRecord } | { ok: false; errors: string[] } {
  const parsed = AnswerSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || 'answer'}: ${i.message}`) }
  return { ok: true, record: toRecord(parsed.data, meta) }
}

export function parseCritiqueRecord(value: unknown): CritiqueRecord | null {
  const parsed = StoredSchema.safeParse(value)
  if (!parsed.success) return null
  const { iteration, model, at, paletteFreedom, ...answer } = parsed.data
  return toRecord(answer, { iteration, model, at, paletteFreedom })
}
