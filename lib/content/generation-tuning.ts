import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'

// Model + sampling tuning shared by the async (non-interactive) generation
// pipeline. Kept here so the published-content model and the thinking/effort
// settings live in one place rather than drifting across generator modules.

// Opus 4.8 is reserved for client-facing published deliverables (page bodies
// and the audit→session draft). Everything else stays on Sonnet/Haiku.
export const PUBLISHED_CONTENT_MODEL = 'claude-opus-4-8'

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
