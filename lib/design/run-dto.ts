// Pure + client-safe: design_runs / design_concepts rows → the DTOs the Studio
// UI renders. Defensive about JSONB; unsigned screenshots are dropped.
import type { Tables } from '@/types/database'
import { parseDesignBundle } from './bundle'
import { capabilitiesFromJson } from './capabilities'
import { metricGateFailures, type RenderMetrics } from './metrics'
import { latestCritique, parseConceptReview, renderGateWarnings, unmeasuredViewports, type ConceptReview } from './review'
import { parseBaseSnapshot, parseScreenshots } from './run-state'
import { CONCEPT_STATUSES, PALETTE_FREEDOMS, RUN_STATUSES, type ConceptStatus, type RunStatus } from './studio-types'
import {
  RUN_STAGES,
  type ConceptReviewDto,
  type DesignConceptDto,
  type DesignRunDto,
  type PaletteFreedom,
  type RunScreenshot,
  type RunStage,
  type ScreenshotDto,
} from './run-types'

type RunRow = Tables<'design_runs'>
// The DTO never reads initial_bundle, so the poll path may omit it.
type ConceptRow = Omit<Tables<'design_concepts'>, 'initial_bundle'>

function oneOf<T extends string>(list: readonly T[], value: string, fallback: T): T {
  return (list as readonly string[]).includes(value) ? (value as T) : fallback
}

function toShots(shots: RunScreenshot[], signed: Record<string, string>): ScreenshotDto[] {
  return shots.flatMap((s) => (signed[s.path] ? [{ viewport: s.viewport, url: signed[s.path], width: s.width, height: s.height }] : []))
}

export function runScreenshotPaths(
  run: Pick<RunRow, 'base_snapshot'>,
  concepts: (Pick<ConceptRow, 'screenshots'> & Partial<Pick<ConceptRow, 'critique'>>)[]
): string[] {
  return [
    ...parseBaseSnapshot(run.base_snapshot).screenshots,
    ...concepts.flatMap((c) => parseScreenshots(c.screenshots)),
    ...concepts.flatMap((c) => parseConceptReview(c.critique)?.initialScreenshots ?? []),
  ]
    .map((s) => s.path)
    .filter((p, i, all) => all.indexOf(p) === i)
}

function toReviewDto(review: ConceptReview | null, signed: Record<string, string>, baseline: RenderMetrics | null): ConceptReviewDto | null {
  if (!review) return null
  return {
    next: review.next,
    activeUnit: review.claim?.unit ?? null,
    latest: latestCritique(review),
    critiqueCount: review.critiques.length,
    outcome: review.outcome,
    measured: review.metrics !== null,
    unmeasuredViewports: review.metrics ? unmeasuredViewports(review.metrics) : [],
    gateFailures: review.metrics ? metricGateFailures(review.metrics, baseline).map((f) => f.message) : [],
    renderWarnings: review.metrics ? renderGateWarnings(review, baseline) : [],
    notes: review.notes,
    initialScreenshots: toShots(review.initialScreenshots, signed),
  }
}

export function toConceptDto(row: ConceptRow, signed: Record<string, string>, baseline: RenderMetrics | null = null): DesignConceptDto {
  const parsed = row.bundle === null ? null : parseDesignBundle(row.bundle)
  const bundle = parsed?.ok ? parsed.bundle : null
  return {
    id: row.id,
    runId: row.run_id,
    position: row.position,
    status: oneOf<ConceptStatus>(CONCEPT_STATUSES, row.status, 'error'),
    error: row.error,
    name: bundle?.name ?? `Concept ${row.position + 1}`,
    tagline: bundle?.tagline ?? '',
    rationale: bundle?.rationale ?? '',
    moves: bundle?.moves ?? [],
    palette: bundle?.palette ?? null,
    typography: bundle?.typography ?? null,
    treatments: bundle?.treatments ?? null,
    tokens: bundle ? { roundness: bundle.tokens.roundness, density: bundle.tokens.density, visualFeel: bundle.tokens.visualFeel } : null,
    screenshots: toShots(parseScreenshots(row.screenshots), signed),
    iterations: row.iterations,
    review: toReviewDto(parseConceptReview(row.critique), signed, baseline),
  }
}

export function toRunDto(run: RunRow, concepts: ConceptRow[], signed: Record<string, string>): DesignRunDto {
  const base = parseBaseSnapshot(run.base_snapshot)
  const stage = run.stage && (RUN_STAGES as readonly string[]).includes(run.stage) ? (run.stage as RunStage) : null
  return {
    id: run.id,
    status: oneOf<RunStatus>(RUN_STATUSES, run.status, 'error'),
    stage,
    paletteFreedom: oneOf<PaletteFreedom>(PALETTE_FREEDOMS, run.palette_freedom, 'evolve'),
    conceptCount: run.concept_count,
    adminBrief: run.admin_brief,
    pagePath: base.pagePath,
    costUsd: Number(run.cost_usd),
    costCapUsd: Number(run.cost_cap_usd),
    maxRevisions: run.max_revisions,
    error: run.error,
    notes: base.notes,
    capabilities: capabilitiesFromJson(run.capabilities),
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    currentScreenshots: toShots(base.screenshots, signed),
    concepts: [...concepts].sort((a, b) => a.position - b.position).map((c) => toConceptDto(c, signed, base.metrics ?? null)),
  }
}
