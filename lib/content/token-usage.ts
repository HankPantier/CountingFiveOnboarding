import { createServerClient } from '@/lib/supabase/server'

export type TokenStage = 'keyword' | 'outline' | 'content' | 'idea' | 'resource'

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

// Persist one row per Claude call for billing visibility. Recording must
// never break the pipeline: any failure (e.g. token_usage table not yet
// migrated) is swallowed with a warning.
export async function recordTokenUsage(args: {
  contentJobId?: string | null
  sessionId?: string | null
  stage: TokenStage
  pageUrl?: string | null
  model: string
  inputTokens?: number
  outputTokens?: number
}): Promise<void> {
  const inputTokens = args.inputTokens ?? 0
  const outputTokens = args.outputTokens ?? 0
  const costUsd = estimateCostUsd(args.model, inputTokens, outputTokens)

  try {
    const supabase = createServerClient()
    const { error } = await supabase.from('token_usage').insert({
      content_job_id: args.contentJobId ?? null,
      session_id: args.sessionId ?? null,
      stage: args.stage,
      page_url: args.pageUrl ?? null,
      model: args.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
    })
    if (error) console.warn('[token-usage] Failed to record usage:', error.message)
  } catch (err) {
    console.warn('[token-usage] Failed to record usage:', err)
  }
}
