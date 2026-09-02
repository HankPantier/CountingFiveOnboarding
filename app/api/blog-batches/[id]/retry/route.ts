import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds } from '@/lib/auth/access'
import { runBlogBatch } from '@/lib/content/blog-batch-runner'

export const runtime = 'nodejs'
export const maxDuration = 300

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

  const ideaIds = targets.map((t) => t.resource_idea_id).filter((v): v is string => !!v)
  if (ideaIds.length) {
    await supabase
      .from('resource_ideas')
      .update({ draft_status: 'idle', draft_error: null, updated_at: new Date().toISOString() })
      .in('id', ideaIds)
  }
  await supabase
    .from('blog_batch_targets')
    .update({ status: 'pending', error: null, updated_at: new Date().toISOString() })
    .in(
      'id',
      targets.map((t) => t.id)
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

  return NextResponse.json({ retried: targets.length })
}
