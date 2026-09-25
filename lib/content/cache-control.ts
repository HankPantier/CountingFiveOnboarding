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

// One part of the per-call (dynamic) suffix of a multi-part cached message.
// Images are raw bytes downloaded server-side — never hand the model a signed
// URL — with their IANA media type.
export type DynamicPart = { type: 'text'; text: string } | { type: 'image'; image: Uint8Array; mediaType: string }

// Multi-part sibling of buildCachedMessages for vision prompts (Design Studio).
// The static prefix is always a cache breakpoint. `breakAt` adds one on that
// suffix part (text OR image) — the LAST part every call of a run shares
// (firm brief, current design, page markup, reference images), so later
// concepts / iterations / critiques read it back. `cacheDynamic` adds one on
// the LAST text part, so a follow-up turn (a repair request appended after the
// model's answer) re-reads the whole first message. At most 3 breakpoints.
export function buildCachedPartsMessages(
  staticPrefix: string,
  dynamicParts: DynamicPart[],
  opts: { ttl?: CacheTtl; cacheDynamic?: boolean; breakAt?: number } = {},
): ModelMessage[] {
  const breakpoint = opts.ttl === '1h' ? CACHE_EPHEMERAL_1H : CACHE_EPHEMERAL
  const marked = new Set<number>()
  if (opts.breakAt !== undefined && opts.breakAt >= 0 && opts.breakAt < dynamicParts.length) marked.add(opts.breakAt)
  if (opts.cacheDynamic) {
    for (let i = dynamicParts.length - 1; i >= 0; i--) {
      if (dynamicParts[i].type === 'text') {
        marked.add(i)
        break
      }
    }
  }
  const suffix = dynamicParts.map((part, i) => {
    const mark = marked.has(i) ? { providerOptions: breakpoint } : {}
    return part.type === 'text'
      ? { type: 'text' as const, text: part.text, ...mark }
      : { type: 'image' as const, image: part.image, mediaType: part.mediaType, ...mark }
  })
  return [
    {
      role: 'user',
      content: [{ type: 'text' as const, text: staticPrefix, providerOptions: breakpoint }, ...suffix],
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
