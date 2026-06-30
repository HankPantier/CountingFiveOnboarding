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
// NOT by lowering effort.
export const CONTENT_PROVIDER_OPTIONS = {
  anthropic: {
    thinking: { type: 'adaptive', display: 'omitted' },
    effort: 'high',
  } satisfies AnthropicProviderOptions,
}

// Outline generation is a small, structural JSON task — it does not need the
// high-effort reasoning the page-body generator uses. High effort against a
// tight output budget starved the JSON answer (truncated → parse failure →
// single-section fallback placeholder) and made each call slow. Low effort keeps
// the reasoning short so the full outline JSON fits and returns fast.
export const OUTLINE_PROVIDER_OPTIONS = {
  anthropic: {
    thinking: { type: 'adaptive', display: 'omitted' },
    effort: 'low',
  } satisfies AnthropicProviderOptions,
}
