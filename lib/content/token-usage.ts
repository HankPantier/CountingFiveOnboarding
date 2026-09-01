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
  createdBy?: string | null
  stage: TokenStage
  pageUrl?: string | null
  model: string
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}): Promise<void> {
  const inputTokens = args.inputTokens ?? 0
  const outputTokens = args.outputTokens ?? 0
  const cacheReadTokens = args.cacheReadInputTokens ?? 0
  const cacheCreationTokens = args.cacheCreationInputTokens ?? 0
  const costUsd = estimateCostUsd(args.model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)

  try {
    const supabase = createServerClient()
    // Attribute to a person. Interactive callers pass createdBy directly;
    // background generation (no live user) resolves it from the audit's or
    // content job's owner — the same links the migration backfill uses.
    const createdBy = args.createdBy ?? (await resolveActor(supabase, args.auditId, args.contentJobId))
    const { error } = await supabase.from('token_usage').insert({
      task: args.task,
      content_job_id: args.contentJobId ?? null,
      session_id: args.sessionId ?? null,
      audit_id: args.auditId ?? null,
      created_by: createdBy,
      stage: args.stage,
      page_url: args.pageUrl ?? null,
      model: args.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: cacheReadTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      cost_usd: costUsd,
    })
    if (error) console.warn('[token-usage] Failed to record usage:', error.message)
  } catch (err) {
    console.warn('[token-usage] Failed to record usage:', err)
  }
}

// Best-effort actor resolution for background rows that can't pass createdBy.
// Prefers the audit's creator, else the content job's kickoff user. Any lookup
// failure returns null (rows stay "Unattributed") — never breaks recording.
async function resolveActor(
  supabase: ReturnType<typeof createServerClient>,
  auditId?: string | null,
  contentJobId?: string | null
): Promise<string | null> {
  if (auditId) {
    const { data } = await supabase.from('audit_runs').select('created_by').eq('id', auditId).maybeSingle()
    if (data?.created_by) return data.created_by
  }
  if (contentJobId) {
    const { data } = await supabase.from('content_jobs').select('created_by').eq('id', contentJobId).maybeSingle()
    if (data?.created_by) return data.created_by
  }
  return null
}
