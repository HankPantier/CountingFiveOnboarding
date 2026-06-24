import { createServerClient } from '@/lib/supabase/server'
import { generateResourceDraft } from './resource-draft-generator'

// Fan a single locked blog idea out across the batch's selected clients. Each
// target row points at a per-client resource_ideas row; we run the existing
// per-idea drafting pipeline (generateResourceDraft) for each, so every client
// gets a unique article written against its own MBP and committed to its repo
// draft branch. Structurally mirrors runContentGeneration: batch-of-3 +
// soft-deadline + authenticated self-chain to stay under the 300s route cap.
const BATCH_SIZE = 3
const SOFT_DEADLINE_MS = 240_000

export async function runBlogBatch(batchId: string): Promise<void> {
  const supabase = createServerClient()

  const { data: targets } = await supabase
    .from('blog_batch_targets')
    .select('id, resource_idea_id, status')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true })

  if (!targets?.length) {
    console.warn('[blog-batch] No targets for batch:', batchId)
    return
  }

  // Only un-started targets need work; this makes the runner idempotent across
  // chained continuations. generateResourceDraft holds its own atomic lock.
  const pending = targets.filter((t) => t.status === 'pending' && t.resource_idea_id)

  const startedAt = Date.now()
  let completedThisRun = 0

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      console.warn(`[blog-batch] Soft deadline reached after ${i} targets, chaining continuation.`)
      break
    }
    const batch = pending.slice(i, i + BATCH_SIZE)
    await Promise.all(
      batch.map(async (target) => {
        const ideaId = target.resource_idea_id as string
        await supabase
          .from('blog_batch_targets')
          .update({ status: 'generating', updated_at: new Date().toISOString() })
          .eq('id', target.id)

        const result = await generateResourceDraft(ideaId)
        // 'skipped' = another worker owns the idea lock; leave it 'generating'
        // and let the reconciliation pass below settle it from draft_status.
        const next =
          result.status === 'complete' ? 'complete' : result.status === 'error' ? 'error' : 'generating'
        await supabase
          .from('blog_batch_targets')
          .update({
            status: next,
            error: result.status === 'error' ? result.error ?? 'Generation failed' : null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', target.id)
        completedThisRun += 1
      })
    )
  }

  // Reconcile any target stuck 'generating' (a 'skipped' result) against the
  // idea's real draft_status, so a concurrently-finished draft still closes out.
  const { data: stuck } = await supabase
    .from('blog_batch_targets')
    .select('id, resource_idea_id')
    .eq('batch_id', batchId)
    .eq('status', 'generating')
  for (const t of stuck ?? []) {
    if (!t.resource_idea_id) continue
    const { data: idea } = await supabase
      .from('resource_ideas')
      .select('draft_status, draft_error')
      .eq('id', t.resource_idea_id)
      .single()
    if (idea?.draft_status === 'complete') {
      await supabase
        .from('blog_batch_targets')
        .update({ status: 'complete', updated_at: new Date().toISOString() })
        .eq('id', t.id)
    } else if (idea?.draft_status === 'error') {
      await supabase
        .from('blog_batch_targets')
        .update({ status: 'error', error: idea.draft_error ?? 'Generation failed', updated_at: new Date().toISOString() })
        .eq('id', t.id)
    }
  }

  const { data: allTargets } = await supabase
    .from('blog_batch_targets')
    .select('status')
    .eq('batch_id', batchId)

  const rows = allTargets ?? []
  const unresolved = rows.filter((t) => t.status === 'pending' || t.status === 'generating')
  const allDone = unresolved.length === 0

  // Auto-chain when work remains and this run made progress. The
  // completedThisRun guard prevents an endless cascade if every draft stalls.
  if (!allDone && completedThisRun > 0) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
    const cronSecret = process.env.CRON_SECRET
    if (!baseUrl || !cronSecret) {
      console.warn('[blog-batch] Auto-chain skipped — NEXT_PUBLIC_APP_URL or CRON_SECRET missing.')
      return
    }
    const url = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`
    try {
      const res = await fetch(`${url}/api/blog-batches/${batchId}/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cronSecret}` },
      })
      console.warn(`[blog-batch] Chained continuation: completed=${completedThisRun} this run, status=${res.status}`)
    } catch (err) {
      console.error('[blog-batch] Auto-chain self-call failed:', err)
    }
    return
  }

  if (allDone) {
    const completed = rows.filter((t) => t.status === 'complete').length
    const errored = rows.filter((t) => t.status === 'error').length
    const status = completed === 0 && errored > 0 ? 'error' : 'complete'
    await supabase
      .from('blog_batches')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', batchId)
    console.warn(`[blog-batch] Batch ${batchId} done: complete=${completed} error=${errored}`)
  }
}
