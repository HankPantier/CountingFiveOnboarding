import { after, NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { runAuditBatch } from '@/lib/audit/batch-runner'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Re-entrypoint for the runner's self-chain, the cron resume, and manual
// retries. Two auth paths, mirroring app/api/blog-batches/[id]/generate:
//   1. Bearer CRON_SECRET — runAuditBatch chaining itself across invocations.
//   2. Admin session — a human retrying from the UI.
// An empty CRON_SECRET disables path 1; it never becomes a bypass because the
// request then falls through to the admin gate.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('Authorization')
  const isInternalChain = !!cronSecret && authHeader === `Bearer ${cronSecret}`

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 })

  if (!isInternalChain) {
    const auth = await requireAdminUser()
    if (auth instanceof NextResponse) return auth
  }

  const supabase = createServerClient()
  const { data: batch } = await supabase.from('audit_batches').select('id').eq('id', id).single()
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  after(async () => {
    try {
      await runAuditBatch(id)
    } catch (err) {
      console.error('[audit-batch] Trigger failed:', err)
    }
  })

  return NextResponse.json({ success: true, chained: isInternalChain })
}
