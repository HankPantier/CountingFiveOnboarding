import { createServerClient } from '@/lib/supabase/server'
import { estimateCostUsd, type TokenTask, type TokenStage } from './token-pricing'

// Re-export the pure pricing/types so existing importers of this module keep
// working. Client-reachable code (lib/tokens/aggregate.ts) imports from
// ./token-pricing directly to avoid pulling the server client into the bundle.
export { estimateCostUsd } from './token-pricing'
export type { TokenTask, TokenStage, TokenContext } from './token-pricing'

// Persist one row per Claude call for billing visibility. Recording must
// never break the pipeline: any failure (e.g. token_usage table not yet
// migrated) is swallowed with a warning.
export async function recordTokenUsage(args: {
  task: TokenTask
  contentJobId?: string | null
  sessionId?: string | null
  auditId?: string | null
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
      task: args.task,
      content_job_id: args.contentJobId ?? null,
      session_id: args.sessionId ?? null,
      audit_id: args.auditId ?? null,
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
