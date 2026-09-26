// Pure + client-safe helpers behind the Design Studio run UI (components are
// not covered by vitest, so their logic lives here).
import { RUN_ACTIVE_STATUSES, type DesignInputDto } from './studio-types'
import { MAX_RUN_INPUTS, type DesignConceptDto, type DesignRunDto } from './run-types'
import { refineStatusLabel } from './critique-ui'

export const PREVIEW_VIEWPORTS = [
  { width: 1440, height: 900, label: 'Desktop' },
  { width: 768, height: 1024, label: 'Tablet' },
  { width: 390, height: 844, label: 'Mobile' },
] as const
export type PreviewViewport = (typeof PREVIEW_VIEWPORTS)[number]

export const RUN_POLL_MS = 4000

// Sequential polling: waits `delayMs`, runs `tick`, and only schedules the next
// tick after this one has SETTLED (so slow responses never pile up the way a
// setInterval(async …) does). `tick` resolves false to stop; a rejected tick
// counts as transient and polling continues. Returns a stop function that
// clears the pending timer and suppresses any later scheduling.
export function startSequentialPoll(tick: () => Promise<boolean>, delayMs: number): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = () => {
    if (stopped) return
    timer = setTimeout(async () => {
      timer = null
      let again = true
      try {
        again = await tick()
      } catch {
        again = true
      }
      if (again) schedule()
    }, delayMs)
  }
  schedule()
  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
}

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

// Generation designs one concept per step: k = the concepts already settled
// (accepted or rejected) + 1, capped at the run's concept count.
export function designingConceptNumber(run: Pick<DesignRunDto, 'conceptCount' | 'concepts'>): number {
  const settled = run.concepts.filter((c) => c.status !== 'generating' && c.status !== 'error').length
  return Math.max(1, Math.min(settled + 1, run.conceptCount))
}

export function runStatusLabel(run: Pick<DesignRunDto, 'status' | 'concepts' | 'conceptCount'> & Partial<Pick<DesignRunDto, 'maxRevisions'>>): string {
  switch (run.status) {
    case 'queued':
      return 'Queued…'
    case 'capturing':
    case 'generating':
      return `Designing concept ${designingConceptNumber(run)} of ${run.conceptCount}… (usually 2–4 minutes each)`
    case 'refining': {
      const loop = refineStatusLabel({ concepts: run.concepts, maxRevisions: run.maxRevisions ?? 2 })
      if (loop) return loop
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

// RunLauncher's cost line. With the P4 critique loop (critique + up to
// max-revisions redesigns per concept) a run typically lands around $2–5; the
// hard cap comes from the run default so the copy can't drift from it.
export function runCostCopy(capUsd: number): string {
  const cap = Number.isInteger(capUsd) ? `$${capUsd}` : formatUsd(capUsd)
  return `A run usually costs about $2–5 including the critique-and-revise loop (hard cap ${cap}).`
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

// The render-check failures listed in an apply 422 body (P4 hard gates).
export function applyGateFailures(body: unknown): string[] {
  if (body === null || typeof body !== 'object') return []
  const list = (body as Record<string, unknown>).failures
  return Array.isArray(list) ? list.filter((f): f is string => typeof f === 'string') : []
}

// Focus trap (modal dialogs): where Tab / Shift+Tab should land, given the
// index of the focused element among the dialog's focusables (-1 = focus is
// on the dialog itself or outside it). null = let the browser move focus.
export function trapFocusIndex(current: number, count: number, shift: boolean): number | null {
  if (count <= 0) return null
  if (current < 0) return shift ? count - 1 : 0
  if (shift && current === 0) return count - 1
  if (!shift && current === count - 1) return 0
  return null
}

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), canvas[tabindex], [tabindex]:not([tabindex="-1"])'

// A scroll box counts as "at the bottom" within this many px (streamed output
// keeps it pinned there; once the reader scrolls up it stays put).
export const NEAR_BOTTOM_PX = 48
export function isNearBottom(scrollTop: number, clientHeight: number, scrollHeight: number, slack: number = NEAR_BOTTOM_PX): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= slack
}

// Signed Storage URLs carry a fresh token on every response, so re-rendering
// a polled DTO re-downloads every screenshot. The cache keeps the FIRST URL
// seen for each object (keyed by the URL without its query) until it is
// SIGNED_URL_REUSE_MS old — well inside the 1 h signing TTL — then adopts the
// next fresh one. Pure: returns a new value; `cache` is the caller's (a ref).
export const SIGNED_URL_REUSE_MS = 45 * 60 * 1000
const SIGNED_URL_RE = /\/storage\/v1\/object\/sign\//
export type SignedUrlCache = Map<string, { url: string; at: number }>

export function stabilizeSignedUrls<T>(value: T, cache: SignedUrlCache, now: number, maxAgeMs: number = SIGNED_URL_REUSE_MS): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (!SIGNED_URL_RE.test(v)) return v
      const key = v.split('?')[0]
      const hit = cache.get(key)
      if (hit && now - hit.at < maxAgeMs) return hit.url
      cache.set(key, { url: v, at: now })
      return v
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) out[k] = walk(x)
      return out
    }
    return v
  }
  return walk(value) as T
}

// Signed URLs are 1 h: a view left open longer (tab in the background over
// lunch) reloads its data when it becomes visible again after this long.
export const SIGNED_VIEW_STALE_MS = 50 * 60 * 1000
