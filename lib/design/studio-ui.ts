// Pure + client-safe helpers behind the Design Studio run UI (components are
// not covered by vitest, so their logic lives here).
import { RUN_ACTIVE_STATUSES, type DesignInputDto } from './studio-types'
import { MAX_RUN_INPUTS, type DesignConceptDto, type DesignRunDto } from './run-types'

export const PREVIEW_VIEWPORTS = [
  { width: 1440, height: 900, label: 'Desktop' },
  { width: 768, height: 1024, label: 'Tablet' },
  { width: 390, height: 844, label: 'Mobile' },
] as const
export type PreviewViewport = (typeof PREVIEW_VIEWPORTS)[number]

export const RUN_POLL_MS = 4000

export function viewportScale(containerWidth: number, viewportWidth: number): number {
  if (!(containerWidth > 0) || !(viewportWidth > 0)) return 1
  return Math.min(1, Math.max(0.1, containerWidth / viewportWidth))
}

// Proportional scroll sync: the same fraction of each pane's scrollable range.
export function syncedScrollTop(sourceTop: number, sourceRange: number, targetRange: number): number {
  if (sourceRange <= 0 || targetRange <= 0) return 0
  const fraction = Math.min(Math.max(sourceTop, 0), sourceRange) / sourceRange
  return Math.round(fraction * targetRange)
}

export function runIsActive(run: Pick<DesignRunDto, 'status'> | null): boolean {
  return run !== null && (RUN_ACTIVE_STATUSES as readonly string[]).includes(run.status)
}

export function runStatusLabel(run: Pick<DesignRunDto, 'status' | 'concepts'>): string {
  switch (run.status) {
    case 'queued':
      return 'Queued…'
    case 'capturing':
    case 'generating':
      return 'Designing concepts… (usually 2–5 minutes)'
    case 'refining': {
      const renderable = run.concepts.filter((c) => c.palette !== null && c.status !== 'rejected')
      const done = renderable.filter((c) => c.status === 'ready').length
      return `Rendering previews… (${done} of ${renderable.length})`
    }
    case 'ready':
      return 'Concepts ready'
    case 'applied':
      return 'A concept from this run was applied'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'This run failed'
  }
}

// An input a run can use: captured ('ok') and not archived.
function isRunEligible(input: DesignInputDto): boolean {
  return !input.archived && input.captureStatus === 'ok'
}

export function defaultRunInputIds(inputs: DesignInputDto[]): string[] {
  return inputs
    .filter(isRunEligible)
    .slice(0, MAX_RUN_INPUTS)
    .map((i) => i.id)
}

// The admin's selection intersected with the CURRENT eligible inputs: drops
// ids that were deleted, archived or lost their capture since they were
// picked (a stale id would make POST design/runs 400). Keeps selection order,
// never adds ids, dedupes and caps at MAX_RUN_INPUTS.
export function reconcileRunInputIds(selected: readonly string[], inputs: DesignInputDto[]): string[] {
  const eligible = new Set(inputs.filter(isRunEligible).map((i) => i.id))
  const out: string[] = []
  for (const id of selected) {
    if (out.length >= MAX_RUN_INPUTS) break
    if (eligible.has(id) && !out.includes(id)) out.push(id)
  }
  return out
}

export function applicableConcepts(run: Pick<DesignRunDto, 'concepts'>): DesignConceptDto[] {
  return run.concepts.filter((c) => c.status === 'ready' && c.palette !== null)
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

// A failed Design Studio API call, reduced to what the UI needs.
export type ApiFailureInfo = { status: number; error: string | null; stale: boolean }

export function apiFailureInfo(status: number, body: unknown): ApiFailureInfo {
  const obj = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null
  return {
    status,
    error: obj && typeof obj.error === 'string' && obj.error ? obj.error : null,
    stale: obj?.stale === true,
  }
}

export const STALE_DRAFT_MESSAGE = 'The draft changed since this run — refresh and try again.'

// What the Apply dialog shows for a refused / failed apply. 4xx messages are
// our own deliberate text (stale draft 409, missing brand/design or version
// conflict 409, capability / validation 422), so they are shown as-is; a
// stale-sha 409 is prefixed with a plain explanation. 5xx keeps the generic
// message the API helper produced.
export function applyErrorMessage(failure: ApiFailureInfo, genericMessage: string): string {
  if (failure.status >= 500) return genericMessage
  if (failure.status === 409 && failure.stale) {
    return failure.error && failure.error !== STALE_DRAFT_MESSAGE ? `${STALE_DRAFT_MESSAGE} ${failure.error}` : STALE_DRAFT_MESSAGE
  }
  if (failure.status >= 400 && failure.error) return failure.error
  return genericMessage
}
