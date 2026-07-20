import { after, NextResponse } from 'next/server'
import { requireAuditAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { refreshAuditJob } from '@/lib/audit/worker'

export const runtime = 'nodejs'
export const maxDuration = 300

// POST /api/audits/[id]/refresh — re-run the html-independent intelligence
// (social & local presence + narrative) on a COMPLETED audit's stored data and
// re-merge the social recommendations. No re-crawl and no re-scoring: scores,
// findings, and page analysis are preserved. Same two auth paths as /run.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('Authorization')
  const isInternalChain = !!cronSecret && authHeader === `Bearer ${cronSecret}`

  const { id } = await params

  if (!isInternalChain) {
    const auth = await requireAuditAccess(id)
    if (auth instanceof NextResponse) return auth
  }

  const supabase = createServerClient()

  // Atomic guard: flip a COMPLETED audit (with a stored result) into a running
  // state, so a refresh can't collide with a run/refresh already in flight or
  // start on an audit that never finished.
  const { data: locked } = await supabase
    .from('audit_runs')
    .update({
      audit_status: 'researching',
      status_detail: 'Refreshing social & local presence…',
      started_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', id)
    .eq('audit_status', 'complete')
    .not('result', 'is', null)
    .select('id')

  if (!locked?.length) {
    const { data: exists } = await supabase.from('audit_runs').select('id').eq('id', id).maybeSingle()
    if (!exists) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
    // Already running, or not in a completed state to refresh from.
    return NextResponse.json({ status: 'skipped' })
  }

  after(async () => {
    try {
      await refreshAuditJob(id)
    } catch (err) {
      console.error('[audit] refresh trigger failed:', err)
    }
  })

  return NextResponse.json({ success: true })
}
