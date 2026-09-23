import type { ModelMessage, LanguageModelUsage } from 'ai'
import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { CacheTtl } from './token-pricing'

// Shared Anthropic prompt-cache wiring for the async batch generators. Prompt
// caching pays off when a large, identical prefix is reused across many calls in
// a short window: cache writes cost 1.25x the input rate, reads 0.10x, and the
// entry lives ~5 minutes — so a per-site prefix reused across a 20-26 page job
// (all within ~100s) drops the cached portion by roughly 90%. Centralized here
// so the three generators share one shape and can't drift.

// Ephemeral cache breakpoint applied to the static-prefix text part. Anthropic
// caches everything up to and including the marked part; the dynamic part after
// it is always a fresh read.
export const CACHE_EPHEMERAL = {
  anthropic: { cacheControl: { type: 'ephemeral' } } satisfies AnthropicProviderOptions,
}

// Same breakpoint with a 1-hour TTL. Writes cost 2x input (vs 1.25x) but the
// entry survives gaps between cron ticks, so it pays off from the second read.
// Use for prefixes reused across a batch that runs slower than one call / 5 min.
export const CACHE_EPHEMERAL_1H = {
  anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } satisfies AnthropicProviderOptions,
}

// Request-level automatic caching for multi-turn / multi-step chats: Anthropic
// places the breakpoint on the last cacheable block and moves it forward as the
// conversation grows, so every tool-loop step and every follow-up turn within 5
// minutes re-reads tools + system + history at 0.1x. Safe on Haiku (no effort).
export const AUTO_CACHE_OPTIONS = { cacheControl: { type: 'ephemeral' } } satisfies AnthropicProviderOptions

// Build a single user message split into a cacheable static prefix + a dynamic
// suffix. The model still sees one continuous prompt. Callers MUST put only
// job-constant text in `staticPrefix` (brand voice, firm context, format /
// block-annotation rules, anti-slop rules) and everything per-item (the page /
// post spec, keywords, retry notes) in `dynamicSuffix` — any per-call value that
// leaks into the prefix makes it differ between calls and defeats the cache.
export function buildCachedMessages(
  staticPrefix: string,
  dynamicSuffix: string,
  ttl: CacheTtl = '5m',
): ModelMessage[] {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: staticPrefix, providerOptions: ttl === '1h' ? CACHE_EPHEMERAL_1H : CACHE_EPHEMERAL },
        { type: 'text', text: dynamicSuffix },
      ],
    },
  ]
}

// Pull the cache-token split out of an AI SDK usage object. Reads surface as
// `inputTokenDetails.cacheReadTokens`, writes as `cacheWriteTokens`. Note
// `usage.inputTokens` is the TOTAL (uncached + read + write), so cost accounting
// (estimateCostUsd) subtracts these two to price the uncached remainder.
export function extractCacheUsage(usage: LanguageModelUsage | undefined): {
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
} {
  return {
    cacheReadInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheCreationInputTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
  }
}
