// Time budgeting for the async generation pipelines.
//
// The invariant every async runner must hold: a Vercel function is NEVER killed
// by `maxDuration`. It either finishes its work or stops deliberately and chains
// a fresh invocation. A killed function is the expensive failure — it leaves rows
// claimed as `running`/`drafting` with nobody working on them, and nothing can
// touch them until a sweep notices.
//
// Sized from measured production latency (882 page-body calls): p50 82s, p90
// 114s, p95 123s, max 190s per model call. The pre-existing "~12s per page"
// assumption in the batch runner predated Sonnet 5 + adaptive thinking and was
// off by ~7x, which is why batches were starting with far too little budget left.

// Hard ceiling for a single model call. Above the measured 190s max, so a healthy
// call is never cut short — this aborts genuinely hung calls only. `abortSignal`
// bounds the WHOLE call including the AI SDK's internal maxRetries backoff, which
// is what makes it a real ceiling rather than a per-attempt one.
export const PER_CALL_CAP_MS = 200_000

// Don't start another unit of work with less than this left: below it the call
// would be aborted mid-flight, which costs tokens and buys nothing. Chain instead.
export const MIN_VIABLE_MS = 150_000

// Held back from the invocation for the post-loop completion check, phase
// advance, notification email and the chain self-fetch.
export const RESERVE_MS = 90_000

// Smaller ceilings for the lighter pipelines (measured `stage='resource'` output
// p50 3,468 tokens vs 8,424 for a page body; outlines p50 881).
export const RESOURCE_CALL_CAP_MS = 120_000
// Ceiling for the small Haiku helper calls (reverse-link, brand-fit, link
// injection, resolve). Their p99 is a few seconds; this only catches hangs.
export const HELPER_CALL_CAP_MS = 30_000
export const OUTLINE_CALL_CAP_MS = 90_000

/**
 * Timeout for one model call: `capMs`, shrunk to what's left before the absolute
 * `deadlineAt` (epoch ms). Never returns <= 0 (AbortSignal.timeout throws on a
 * negative value); callers that must not start a doomed call check
 * `msUntil(deadlineAt)` first.
 */
export function clipToDeadline(deadlineAt: number | undefined, capMs: number, now: number = Date.now()): number {
  if (deadlineAt === undefined) return capMs
  return Math.max(1, Math.min(capMs, deadlineAt - now))
}

/** Milliseconds left before `deadlineAt` (Infinity when there is no deadline). */
export function msUntil(deadlineAt: number | undefined, now: number = Date.now()): number {
  return deadlineAt === undefined ? Infinity : deadlineAt - now
}

export interface GenerationBudget {
  /** Milliseconds left before this invocation must stop working. */
  remaining(): number
  /** Safe to begin another unit of work costing up to `minViableMs`? */
  canStart(minViableMs?: number): boolean
  /** Timeout for one model call: the per-call cap, shrunk to what's actually left. */
  callTimeout(capMs?: number): number
  /** Elapsed ms since the invocation began — for logging. */
  elapsed(): number
}

// `maxDurationMs` must match the route's configured maxDuration. Pass it from the
// caller rather than reading it here so the value stays next to the route it
// describes (and the vercel.json/route-export agreement test can police it).
export function createBudget(opts: {
  maxDurationMs: number
  reserveMs?: number
  now?: () => number
}): GenerationBudget {
  const now = opts.now ?? Date.now
  const startedAt = now()
  const deadline = startedAt + opts.maxDurationMs - (opts.reserveMs ?? RESERVE_MS)
  return {
    remaining: () => deadline - now(),
    canStart: (minViableMs = MIN_VIABLE_MS) => deadline - now() > minViableMs,
    // Never returns <= 0: callers gate on canStart() first, and a 1ms floor keeps
    // AbortSignal.timeout() from throwing on a negative value if they don't.
    callTimeout: (capMs = PER_CALL_CAP_MS) => Math.max(1, Math.min(capMs, deadline - now())),
    elapsed: () => now() - startedAt,
  }
}

// Why a generation attempt failed. Today every failure lands in `generation_error`
// as one opaque string, so a hung call, a provider outage and malformed model JSON
// are indistinguishable without querying the database. Recording the kind lets the
// retry policy differ (back off on overload, escalate the effort ladder on timeout,
// fail fast on validation) and lets the Vercel logs answer "why" on their own.
export type FailureKind =
  | 'timeout'
  | 'provider_overload'
  | 'rate_limit'
  | 'parse_failure'
  | 'validation'
  | 'unknown'

export function classifyGenerationError(err: unknown): FailureKind {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; statusCode?: unknown; status?: unknown }
    // AbortSignal.timeout() rejects with a TimeoutError; a manual abort gives AbortError.
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'timeout'
    const status = typeof e.statusCode === 'number' ? e.statusCode
      : typeof e.status === 'number' ? e.status : null
    if (status === 429) return 'rate_limit'
    if (status === 529 || status === 503 || status === 502) return 'provider_overload'
  }
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/aborted|timed? ?out/i.test(msg)) return 'timeout'
  if (/overloaded|529|503/i.test(msg)) return 'provider_overload'
  if (/rate.?limit|429/i.test(msg)) return 'rate_limit'
  if (/JSON|unexpected token|unparseable/i.test(msg)) return 'parse_failure'
  return 'unknown'
}

// A tagged message for the *_error columns. Keeps the human-readable text while
// making the kind greppable in logs and queryable without a migration.
export function taggedError(kind: FailureKind, message: string): string {
  return `[${kind}] ${message}`
}

// True when retrying could plausibly succeed. A validation failure is the model
// producing structurally wrong output for this input — retrying the same way just
// burns the attempt budget.
export function isRetriableFailure(kind: FailureKind): boolean {
  return kind !== 'validation'
}

// Run `worker` over `items` with at most `concurrency` in flight, stopping early
// when the budget can no longer fit another unit.
//
// Replaces a fixed-size batch loop that checked the deadline only BETWEEN batches.
// That check asked "have I already passed the deadline?" rather than "will the
// next unit finish before the cap?", so a batch could start with 1s of margin, run
// for three more minutes, and take the whole function down — orphaning every row
// in flight. A pool also removes head-of-line blocking: a slot refills the moment
// its page finishes instead of waiting on the slowest member of a batch.
//
// Returns the items that were never started, so the caller can decide to chain.
export async function runWithPool<T>(
  items: T[],
  concurrency: number,
  budget: GenerationBudget,
  worker: (item: T) => Promise<void>,
  minViableMs: number = MIN_VIABLE_MS
): Promise<{ skipped: T[] }> {
  let next = 0
  const skipped: T[] = []

  const runner = async (): Promise<void> => {
    for (;;) {
      if (next >= items.length) return
      if (!budget.canStart(minViableMs)) {
        // Out of budget: everything not yet claimed is left for the next invocation.
        while (next < items.length) skipped.push(items[next++])
        return
      }
      const item = items[next++]
      await worker(item)
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, runner))
  return { skipped }
}
