import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { runContentGeneration } from '@/lib/content/content-generator'

export const runtime = 'nodejs'
export const maxDuration = 600

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Two valid auth paths:
  //   1. Admin session — when a human clicks Restart in the UI.
  //   2. Bearer CRON_SECRET — when runContentGeneration chains itself across
  //      function lifecycles for jobs too large to finish in one invocation.
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('Authorization')
  const isInternalChain =
    !!cronSecret && authHeader === `Bearer ${cronSecret}`

  const { id } = await params

  let actorId: string | null = null
  if (!isInternalChain) {
    const auth = await requireContentJobAccess(id)
    if (auth instanceof NextResponse) return auth
    actorId = auth.user.id
  }

  const supabase = createServerClient()

  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id, created_by')
    .eq('id', id)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
  }

  // Record who kicked off generation so background token rows attribute to them.
  // Only set when unset, to keep the first attributor across cron-chained runs.
  if (actorId && !job.created_by) {
    await supabase.from('content_jobs').update({ created_by: actorId }).eq('id', id)
  }

  // A HUMAN clicking Restart grants a fresh attempt budget to every page that
  // hasn't finished; the internal cron/self-chain (isInternalChain) must NOT, or
  // the cap could never be reached and a genuinely un-generatable page would be
  // retried forever. This is the distinction that was missing: the counter was
  // only ever incremented, so operator retries silently pushed pages past the cap
  // instead of resetting it, and the cap became a no-op.
  if (!isInternalChain) {
    await supabase
      .from('generated_pages')
      .update({ generation_attempts: 0 })
      .eq('content_job_id', id)
      .neq('generation_status', 'complete')
  }

  const sessionId = job.session_id
  after(async () => {
    try {
      await runContentGeneration(id, sessionId)
    } catch (err) {
      console.error('[content-gen] Trigger failed:', err)
    }
  })

  return NextResponse.json({ success: true, chained: isInternalChain })
}
