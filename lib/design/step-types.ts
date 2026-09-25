// Server-side types shared by the orchestrator and the critique-loop units
// (kept apart so refine-stage never imports the orchestrator).
import type { ReviewUnit } from './review'

export type StepContext = { sessionId: string; runId: string; jobId: string; githubRepo: string }

export type StepOutcome =
  // position: the position designed this step (null: no model call).
  | { kind: 'generated'; position: number | null; next: 'generate' | 'render' }
  // One critique-loop unit ran; remaining: some concept still has work.
  | { kind: 'refined'; unit: ReviewUnit | 'finish'; conceptId: string; remaining: boolean }
  // A concept parked mid-loop by a Retry went back to refining (P4).
  | { kind: 'resumed'; conceptId: string }
  | { kind: 'finalized' }
  | { kind: 'noop'; reason: string }
  | { kind: 'failed'; error: string }

// The step route's maxDuration is 600 s; every model call of a step must have
// finished by this point so the function is never killed mid-write.
export const STEP_MODEL_BUDGET_MS = 540_000
