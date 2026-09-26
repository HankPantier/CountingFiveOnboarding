import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds, hasCapability } from '@/lib/auth/access'
import { runBlogBatch } from '@/lib/content/blog-batch-runner'
import { internalError } from '@/lib/api/errors'

export const runtime = 'nodejs'
// Must match BLOG_BATCH_ROUTE_MAX_DURATION_MS (the runner budgets against it).
export const maxDuration = 600

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RetryBody {
  sessionId?: string
  // Regenerate a single already-settled client (complete/error/skipped), not
  // just errored ones — used after a reclassify to re-draft with the new type.
  // Only honored together with a single `sessionId` so it can't mass-redraft.
  force?: boolean
}

// Re-run the clients that errored. Resets each errored target back to 'pending'
// and its idea's draft_status back to 'idle' (so generateResourceDraft can
// re-claim the lock), then re-triggers the runner. With a `sessionId` in the
// body, only that one client is retried; otherwise every errored client is.
// With `force` + a `sessionId`, a settled (complete/error/skipped) target for
// that one client is re-drafted regardless of its current status.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Re-drafting spends generation budget — a manager power, like batch create /
  // refine (admins pass implicitly).
  if (!hasCapability(user, 'manager')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 })

  let body: RetryBody = {}
  try {
    body = (await req.json()) as RetryBody
  } catch {
    // No body — retry all errored clients.
  }
  const singleSessionId =
    typeof body.sessionId === 'string' && UUID_RE.test(body.sessionId) ? body.sessionId : null
  // Force only applies to a single targeted client — never a whole-batch redraft.
  const force = body.force === true && !!singleSessionId

  const supabase = createServerClient()

  const { data: batch } = await supabase.from('blog_batches').select('id').eq('id', id).single()
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const allowed = await getAccessibleSessionIds(user)

  // Managers retry only their own assigned clients within the batch.
  let query = supabase
    .from('blog_batch_targets')
    .select('id, resource_idea_id, session_id')
    .eq('batch_id', id)
  // Force redraws a settled target; otherwise only errored ones are picked up.
  // Either way in-flight targets (pending/generating) are left alone.
  query = force
    ? query.in('status', ['complete', 'error', 'skipped'])
    : query.eq('status', 'error')
  if (singleSessionId) query = query.eq('session_id', singleSessionId)
  if (allowed !== null) {
    if (allowed.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    query = query.in('session_id', allowed)
  }
  const { data: errored } = await query
  const targets = errored ?? []

  if (targets.length === 0) {
    return NextResponse.json({ retried: 0 })
  }

  // Reset each idea's lock, but NEVER one that is mid-draft: a library run
  // reuses the batch target's idea, so an idea can be 'running' under another
  // worker while this target reads 'error'. Flipping it to idle let this runner
  // re-claim it — two concurrent drafts of one idea, racing commits to the same
  // draft branch. Only targets whose idea was actually reset are retried.
  const ideaIds = targets.map((t) => t.resource_idea_id).filter((v): v is string => !!v)
  let retryable = targets
  if (ideaIds.length) {
    const { data: reset, error: resetErr } = await supabase
      .from('resource_ideas')
      .update({ draft_status: 'idle', draft_error: null, updated_at: new Date().toISOString() })
      .in('id', ideaIds)
      .neq('draft_status', 'running')
      .select('id')
    if (resetErr) return internalError('blog-batch retry', resetErr, 'Could not reset the drafts for retry')
    const resetIds = new Set((reset ?? []).map((r) => r.id))
    retryable = targets.filter((t) => !t.resource_idea_id || resetIds.has(t.resource_idea_id))
  }
  const inFlight = targets.length - retryable.length
  if (retryable.length === 0) {
    return NextResponse.json(
      { error: 'These articles are still being drafted — retry once they finish.' },
      { status: 409 }
    )
  }

  await supabase
    .from('blog_batch_targets')
    // A human retry grants a fresh auto-retry budget (attempts → 0).
    .update({ status: 'pending', error: null, attempts: 0, updated_at: new Date().toISOString() })
    .in(
      'id',
      retryable.map((t) => t.id)
    )
  await supabase
    .from('blog_batches')
    .update({ status: 'generating', updated_at: new Date().toISOString() })
    .eq('id', id)

  after(async () => {
    try {
      await runBlogBatch(id)
    } catch (err) {
      console.error('[blog-batch] Retry trigger failed:', err)
    }
  })

  return NextResponse.json({ retried: retryable.length, ...(inFlight ? { skippedInFlight: inFlight } : {}) })
}
