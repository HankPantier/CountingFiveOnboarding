import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds } from '@/lib/auth/access'
import { runBlogBatch } from '@/lib/content/blog-batch-runner'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Re-entrypoint for the runner's self-chain and for manual retries. Two auth
// paths, mirroring the content-generation generate route:
//   1. Bearer CRON_SECRET — runBlogBatch chaining itself across invocations.
//   2. Admin/manager session — a human retrying from the UI.
// An empty CRON_SECRET simply disables path 1; it never becomes a bypass
// because the request then falls through to the session gate.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('Authorization')
  const isInternalChain = !!cronSecret && authHeader === `Bearer ${cronSecret}`

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid batch id' }, { status: 400 })

  const supabase = createServerClient()

  if (!isInternalChain) {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const allowed = await getAccessibleSessionIds(user)
    if (allowed !== null) {
      const { data: accessibleTarget } = await supabase
        .from('blog_batch_targets')
        .select('id')
        .eq('batch_id', id)
        .in('session_id', allowed)
        .limit(1)
        .maybeSingle()
      if (!accessibleTarget) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { data: batch } = await supabase.from('blog_batches').select('id').eq('id', id).single()
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  after(async () => {
    try {
      await runBlogBatch(id)
    } catch (err) {
      console.error('[blog-batch] Trigger failed:', err)
    }
  })

  return NextResponse.json({ success: true, chained: isInternalChain })
}
