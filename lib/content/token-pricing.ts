// Pure pricing + token typing. NO server-only imports here so this module is
// safe to pull into client bundles (e.g. via lib/tokens/aggregate.ts). The
// DB-writing recordTokenUsage lives in ./token-usage (server-only).

// High-level work category a Claude call belongs to. Drives the per-task
// rollup on the Token Usage dashboard.
export type TokenTask = 'onboarding' | 'audit' | 'content'

export type TokenStage =
  | 'keyword'
  | 'sitemap'
  | 'outline'
  | 'content'
  | 'idea'
  | 'resource'
  | 'social'
  | 'oneoff'
  | 'onboarding'
  | 'mbp'
  | 'mbp_edit'
  | 'audit'
  | 'audit_edit'
  | 'content_edit'
  | 'theme_edit'
  | 'site_structure_edit'
  | 'seo_fields'
  | 'brand'
  | 'new_page'
  | 'content_assistant'
  | 'critic'

// Attribution context threaded into shared AI helpers (e.g. generateMbpJson)
// so each call records who/what it was for. Omitted fields record as null.
export type TokenContext = {
  task: TokenTask
  stage: TokenStage
  sessionId?: string | null
  contentJobId?: string | null
  auditId?: string | null
  pageUrl?: string | null
}

// USD per 1,000,000 tokens, keyed by model id. Verify against current
// Anthropic pricing before relying on cost_usd for actual billing — these
// are the published Sonnet/Haiku tier rates and may drift over time.
// A model id missing from this map silently prices at $0, so every model used
// anywhere in the app must have an entry here.
const PRICING: Record<string, { input: number; output: number }> = {
  // Retired writing tier (kept so historical token_usage rows still price).
  'claude-opus-4-8': { input: 5, output: 25 },
  // Sonnet 5 standard rate. Introductory pricing of $2/$10 applies through
  // 2026-08-31 — kept at standard $3/$15 so spend never silently under-records
  // when the intro period ends (slight over-estimate during the intro window).
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
}

// Anthropic prompt-cache multipliers on the input rate: writing (creating) a
// cache entry costs 1.25x, reading one costs 0.10x. `inputTokens` is the TOTAL
// input the AI SDK reports (uncached + read + write), so subtract the cache
// portions before pricing the uncached remainder. Both cache args default 0, so
// existing 3-arg callers price exactly as before.
const CACHE_WRITE_MULTIPLIER = 1.25
const CACHE_READ_MULTIPLIER = 0.1

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheCreationTokens = 0
): number {
  const rate = PRICING[model]
  if (!rate) {
    // A missing entry prices this call at $0 and silently under-reports spend on
    // the Token Usage dashboard. Surface it so a newly-added model id can't hide.
    console.error(`[token-pricing] unknown model "${model}" — recording $0; add it to PRICING`)
  }
  const { input, output } = rate ?? { input: 0, output: 0 }
  const uncachedInput = Math.max(0, inputTokens - cacheReadTokens - cacheCreationTokens)
  return (
    (uncachedInput / 1_000_000) * input +
    (cacheCreationTokens / 1_000_000) * input * CACHE_WRITE_MULTIPLIER +
    (cacheReadTokens / 1_000_000) * input * CACHE_READ_MULTIPLIER +
    (outputTokens / 1_000_000) * output
  )
}
