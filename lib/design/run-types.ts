// Client-safe constants + types for Design Studio RUNS (P3). Imported by the
// UI, the pure helpers and the server units alike — no server imports here.
import type { DesignBundle } from './bundle'
import type { RenderMetrics } from './metrics'
import type { ConceptStatus, RunStatus, ThemeBlobShas } from './studio-types'
import { PALETTE_FREEDOMS } from './studio-types'

export type PaletteFreedom = (typeof PALETTE_FREEDOMS)[number]
export const DEFAULT_PALETTE_FREEDOM: PaletteFreedom = 'evolve'

export const CONCEPT_COUNT_MIN = 2
export const CONCEPT_COUNT_MAX = 3
export const DEFAULT_CONCEPT_COUNT = 3
export const ADMIN_BRIEF_MAX = 4000 // mirrors design_runs.admin_brief CHECK
export const MAX_RUN_INPUTS = 5
// The current-site render + MAX_RUN_INPUTS input screenshots.
export const MAX_PROMPT_IMAGES = 6
export const DEFAULT_RUN_PAGE = '/'

// design_runs.stage (free text in the DB). Migration 078 has no 'rendering'
// status: the render pass runs with status 'refining' + stage 'render' (P4's
// critique loop re-renders inside the same status).
export const RUN_STAGES = ['generate', 'render', 'ready'] as const
export type RunStage = (typeof RUN_STAGES)[number]

// Template capability tier (spec "Capability levels", ruled for P3):
//   L1 palette, tokens, CSS, treatments (default — no/invalid marker)
//   L2 + fonts   L3 + style axes   L4 + specimen page
export type CapabilityLevel = 1 | 2 | 3 | 4
export type DesignCapabilities = {
  level: CapabilityLevel
  source: 'default' | 'marker'
  templateVersion: string | null
  capabilities: string[]
}
export const DEFAULT_CAPABILITIES: DesignCapabilities = { level: 1, source: 'default', templateVersion: null, capabilities: [] }

export type RunViewport = 'desktop' | 'mobile'
export type RunScreenshot = { viewport: RunViewport; path: string; width: number; height: number }

// design_runs.base_snapshot: fixed at creation (page, draft theme shas) and
// completed by the generate step (current-site renders, notes for the admin).
export type RunBaseSnapshot = {
  pagePath: string
  themeShas: ThemeBlobShas
  screenshots: RunScreenshot[]
  notes: string[]
  // The current-site render's metrics (P4): the baseline concept render
  // checks are diffed against. Absent on P3 runs.
  metrics?: RenderMetrics | null
}

export type ScreenshotDto = { viewport: RunViewport; url: string; width: number; height: number }

export type DesignConceptDto = {
  id: string
  runId: string
  position: number
  status: ConceptStatus
  error: string | null
  name: string
  tagline: string
  rationale: string
  moves: string[]
  palette: DesignBundle['palette'] | null
  typography: DesignBundle['typography'] | null
  treatments: DesignBundle['treatments'] | null
  tokens: Pick<DesignBundle['tokens'], 'roundness' | 'density' | 'visualFeel'> | null
  screenshots: ScreenshotDto[]
}

export type DesignRunDto = {
  id: string
  status: RunStatus
  stage: RunStage | null
  paletteFreedom: PaletteFreedom
  conceptCount: number
  adminBrief: string | null
  pagePath: string
  costUsd: number
  costCapUsd: number
  error: string | null
  notes: string[]
  capabilities: DesignCapabilities
  createdAt: string
  updatedAt: string
  currentScreenshots: ScreenshotDto[]
  concepts: DesignConceptDto[]
}

// The design step route's maxDuration (seconds). Next.js needs that export to
// be a literal, so the route writes 600 and a test pins it to this constant.
export const DESIGN_STEP_MAX_DURATION_S = 600
// No step worker can outlive this: a concept row still 'generating' after it
// has no live worker (retry may regenerate it).
export const DESIGN_STEP_MAX_LIFETIME_MS = DESIGN_STEP_MAX_DURATION_S * 1000
