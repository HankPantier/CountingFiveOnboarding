// Pure + client-safe: design_runs / design_concepts rows → the DTOs the Studio
// UI renders. Defensive about JSONB; unsigned screenshots are dropped.
import type { Tables } from '@/types/database'
import { parseDesignBundle } from './bundle'
import { capabilitiesFromJson } from './capabilities'
import { parseBaseSnapshot, parseScreenshots } from './run-state'
import { CONCEPT_STATUSES, PALETTE_FREEDOMS, RUN_STATUSES, type ConceptStatus, type RunStatus } from './studio-types'
import { RUN_STAGES, type DesignConceptDto, type DesignRunDto, type PaletteFreedom, type RunScreenshot, type RunStage, type ScreenshotDto } from './run-types'

type RunRow = Tables<'design_runs'>
type ConceptRow = Tables<'design_concepts'>

function oneOf<T extends string>(list: readonly T[], value: string, fallback: T): T {
  return (list as readonly string[]).includes(value) ? (value as T) : fallback
}

function toShots(shots: RunScreenshot[], signed: Record<string, string>): ScreenshotDto[] {
  return shots.flatMap((s) => (signed[s.path] ? [{ viewport: s.viewport, url: signed[s.path], width: s.width, height: s.height }] : []))
}

export function runScreenshotPaths(run: Pick<RunRow, 'base_snapshot'>, concepts: Pick<ConceptRow, 'screenshots'>[]): string[] {
  return [...parseBaseSnapshot(run.base_snapshot).screenshots, ...concepts.flatMap((c) => parseScreenshots(c.screenshots))].map((s) => s.path)
}

export function toConceptDto(row: ConceptRow, signed: Record<string, string>): DesignConceptDto {
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
    error: run.error,
    notes: base.notes,
    capabilities: capabilitiesFromJson(run.capabilities),
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    currentScreenshots: toShots(base.screenshots, signed),
    concepts: [...concepts].sort((a, b) => a.position - b.position).map((c) => toConceptDto(c, signed)),
  }
}
