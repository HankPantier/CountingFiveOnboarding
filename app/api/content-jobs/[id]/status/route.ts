import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = createServerClient()

  const { data: job } = await supabase
    .from('content_jobs')
    .select('phase, status, updated_at')
    .eq('id', id)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Check for stuck state: phase 3 with no updates for > 10 minutes
  let stuck = false
  if (job.phase === 3) {
    const { data: results } = await supabase
      .from('research_results')
      .select('research_status, created_at')
      .eq('content_job_id', id)

    const hasRunning = results?.some(r => r.research_status === 'running')
    const hasPending = results?.some(r => r.research_status === 'pending')

    if (hasRunning || hasPending) {
      const updatedAt = new Date(job.updated_at).getTime()
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000
      stuck = updatedAt < tenMinutesAgo
    }

    // Mark stuck running rows as error
    if (stuck && hasRunning) {
      await supabase
        .from('research_results')
        .update({ research_status: 'error' })
        .eq('content_job_id', id)
        .eq('research_status', 'running')
    }
  }

  return NextResponse.json({
    phase: job.phase,
    status: job.status,
    stuck,
  })
}
