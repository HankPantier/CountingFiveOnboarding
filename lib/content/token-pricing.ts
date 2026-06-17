// Pure pricing + token typing. NO server-only imports here so this module is
// safe to pull into client bundles (e.g. via lib/tokens/aggregate.ts). The
// DB-writing recordTokenUsage lives in ./token-usage (server-only).

// High-level work category a Claude call belongs to. Drives the per-task
// rollup on the Token Usage dashboard.
export type TokenTask = 'onboarding' | 'audit' | 'content'

export type TokenStage =
  | 'keyword'
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
  | 'brand'

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
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rate = PRICING[model] ?? { input: 0, output: 0 }
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output
}
