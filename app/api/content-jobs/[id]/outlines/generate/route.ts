import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { runOutlineGeneration } from '@/lib/content/outline-generator'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Two valid auth paths (mirrors the page-body generate route):
  //   1. Admin/manager session — when a human triggers from the UI.
  //   2. Bearer CRON_SECRET — when runOutlineGeneration chains itself across
  //      function lifecycles for jobs too large to finish in one invocation.
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('Authorization')
  const isInternalChain = !!cronSecret && authHeader === `Bearer ${cronSecret}`

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

  // after() runs the work after the response is sent and is guaranteed to
  // complete within the function's maxDuration on Vercel. Plain fire-and-
  // forget Promises do not have that guarantee — Vercel terminates pending
  // async work once the response leaves, which is why the previous retry
  // button looked like it kicked off but never actually generated anything.
  after(async () => {
    try {
      await runOutlineGeneration(id, job.session_id)
    } catch (err) {
      console.error('[outline-gen] Manual trigger failed:', err)
    }
  })

  return NextResponse.json({ success: true, chained: isInternalChain })
}
