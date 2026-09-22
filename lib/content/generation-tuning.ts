import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'

// Model + sampling tuning shared by the async (non-interactive) generation
// pipeline. Kept here so the published-content model and the thinking/effort
// settings live in one place rather than drifting across generator modules.

// Sonnet 5 is the writing-tuned tier used for client-facing published
// deliverables (page bodies and the audit→session draft). Moved off Opus 4.8
// (2026-06-30): Sonnet 5 is purpose-tuned for writing and far cheaper. It still
// supports adaptive thinking + effort, so GENERATION_PROVIDER_OPTIONS applies.
export const PUBLISHED_CONTENT_MODEL = 'claude-sonnet-5'

// Adaptive thinking + high effort raises quality on reasoning-heavy generation.
// `display: 'omitted'` keeps the reasoning out of the response (these callers
// only parse the final JSON/text). NEVER apply this to a Haiku call — `effort`
// errors on Haiku 4.5 — or to latency-sensitive interactive chat.
export const GENERATION_PROVIDER_OPTIONS = {
  anthropic: {
    thinking: { type: 'adaptive', display: 'omitted' },
    effort: 'high',
  } satisfies AnthropicProviderOptions,
}

// Page-body generation: a large markdown+metadata JSON answer. High effort for
// best writing quality on the published deliverable. The earlier truncation
// (effort:'high' starving an 8000-token budget) is solved by the generous
// maxOutputTokens at the call site (24000) plus a low-effort retry safety net,
// NOT by lowering effort. Identical to GENERATION_PROVIDER_OPTIONS — aliased
// rather than duplicated so the two can't silently drift apart.
export const CONTENT_PROVIDER_OPTIONS = GENERATION_PROVIDER_OPTIONS

// Outline generation is the structural GATE for every downstream page body — a
// weak or placeholder outline cascades into weak copy. The outline model runs
// high effort (like the body generator) so its section plan is genuinely
// reasoned. The earlier truncation (high effort starving a tight budget →
// single-section fallback) is solved the same way the body generator solved it:
// a generous maxOutputTokens at the call site (12000) plus a low-effort retry
// safety net, NOT by lowering effort on the primary attempt.
export const OUTLINE_PRIMARY_PROVIDER_OPTIONS = {
  anthropic: {
    thinking: { type: 'adaptive', display: 'omitted' },
    effort: 'high',
  } satisfies AnthropicProviderOptions,
}

// Low-effort fallback for the outline retry: if the high-effort primary attempt
// still truncates the JSON, less thinking leaves more of the budget for the
// answer. Also reused by the page-body generator's own truncation retry.
export const OUTLINE_PROVIDER_OPTIONS = {
  anthropic: {
    thinking: { type: 'adaptive', display: 'omitted' },
    effort: 'low',
  } satisfies AnthropicProviderOptions,
}

// Effort ladder for RETRIES. A first attempt keeps today's quality exactly —
// high effort, unchanged. What changes is what a *failed* page gets next.
//
// Previously every retry repeated the identical expensive high-effort call, so a
// page that timed out at high effort timed out again the same way. Production
// bears this out: one page finally succeeded only when it fell through to the
// low-effort path (2,971 output tokens in ~34s, against 12–17k tokens and 80–190s
// for the high-effort attempts that had been failing). Stepping effort DOWN per
// attempt makes each retry both faster and likelier to land, which is the most
// direct lever on the measured 16.7% multi-attempt rate — a finished good page
// beats a missing perfect one.
const EFFORT_LADDER = ['high', 'medium', 'low'] as const

export function providerOptionsForAttempt(attempt: number): typeof GENERATION_PROVIDER_OPTIONS {
  // attempt is 1-based; anything past the ladder stays at its cheapest rung.
  const idx = Math.min(Math.max(1, attempt), EFFORT_LADDER.length) - 1
  return {
    anthropic: {
      thinking: { type: 'adaptive', display: 'omitted' },
      effort: EFFORT_LADDER[idx],
    },
  } as typeof GENERATION_PROVIDER_OPTIONS
}
