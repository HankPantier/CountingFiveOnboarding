import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { runContentGeneration } from '@/lib/content/content-generator'

export const runtime = 'nodejs'
// Routes that trigger content generation need a long maxDuration because the
// after() block runs the pipeline post-response. PATCHes that don't trigger
// generation complete in milliseconds and exit immediately — the longer cap
// only applies when there's pending work.
export const maxDuration = 300

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _jobId } = await params
  const auth = await requireContentJobAccess(_jobId)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await req.json()

  const supabase = createServerClient()

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.palette !== undefined) updates.palette = body.palette
  if (body.design_tokens !== undefined) updates.design_tokens = body.design_tokens
  if (body.confirmed_sitemap !== undefined) updates.confirmed_sitemap = body.confirmed_sitemap
  if (body.nav_config !== undefined) updates.nav_config = body.nav_config
  if (body.phase !== undefined) updates.phase = body.phase
  if (body.status !== undefined) {
    const validStatuses = ['active', 'complete', 'error']
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updates.status = body.status
  }
  if (body.error_message !== undefined) updates.error_message = body.error_message

  const { data, error } = await supabase
    .from('content_jobs')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Auto-trigger content generation when advancing to phase 5.
  // after() guarantees the work runs within maxDuration on Vercel; plain
  // fire-and-forget gets terminated once the response leaves the function.
  if (body.phase === 5 && data.session_id) {
    const sessionId = data.session_id
    after(async () => {
      try {
        await runContentGeneration(id, sessionId)
      } catch (err) {
        console.error('[content-gen] Auto-trigger failed:', err)
      }
    })
  }

  return NextResponse.json({ contentJob: data })
}
