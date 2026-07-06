import { after, NextResponse } from 'next/server'
import { requireAuditAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { runAuditJob } from '@/lib/audit/worker'

export const runtime = 'nodejs'
export const maxDuration = 300

// Running states the atomic guard must not start a second run over. Keep in
// sync with RUNNING_AUDIT_STATES in app/api/cron/sweep-stuck-jobs/route.ts.
const RUNNING_STATES = '(crawling,analyzing,researching,scoring,rendering)'

// POST /api/audits/[id]/run — execute the audit in the background.
// Two valid auth paths, mirroring content-jobs/[id]/generate:
//   1. Authorized user — an admin, or an auditor who owns this audit.
//   2. Bearer CRON_SECRET — reserved for an internal/scheduled trigger.
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

  // Atomic concurrency guard: flip to a running state only if not already
  // running, so a double-click can't start two runs for the same audit.
  const { data: locked } = await supabase
    .from('audit_runs')
    .update({
      audit_status: 'crawling',
      status_detail: 'Starting…',
      started_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', id)
    .not('audit_status', 'in', RUNNING_STATES)
    .select('id')

  if (!locked?.length) {
    // Either the audit is already running, or it does not exist.
    const { data: exists } = await supabase.from('audit_runs').select('id').eq('id', id).maybeSingle()
    if (!exists) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
    return NextResponse.json({ status: 'skipped' })
  }

  after(async () => {
    try {
      await runAuditJob(id)
    } catch (err) {
      console.error('[audit] trigger failed:', err)
    }
  })

  return NextResponse.json({ success: true })
}
