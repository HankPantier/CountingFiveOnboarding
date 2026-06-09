import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { runContentGeneration } from '@/lib/content/content-generator'

export const runtime = 'nodejs'
export const maxDuration = 300

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

  if (!isInternalChain) {
    const auth = await requireContentJobAccess(id)
    if (auth instanceof NextResponse) return auth
  }

  const supabase = createServerClient()

  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id')
    .eq('id', id)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
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
