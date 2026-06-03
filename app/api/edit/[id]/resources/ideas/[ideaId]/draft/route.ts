import { after, NextResponse } from 'next/server'
import { resolveEditContext } from '../../../../_helpers'
import { createServerClient } from '@/lib/supabase/server'
import { generateResourceDraft } from '@/lib/content/resource-draft-generator'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; ideaId: string }> }
) {
  const { id, ideaId } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  if (!UUID_RE.test(ideaId)) {
    return NextResponse.json({ error: 'Invalid idea id' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: idea } = await supabase
    .from('resource_ideas')
    .select('id, status, draft_status')
    .eq('id', ideaId)
    .eq('content_job_id', ctx.jobId)
    .single()
  if (!idea) {
    return NextResponse.json({ error: 'Idea not found' }, { status: 404 })
  }
  if (idea.status === 'dismissed') {
    return NextResponse.json({ error: 'Idea is dismissed' }, { status: 409 })
  }
  // Defense in depth over the SQL lock inside generateResourceDraft.
  if (idea.draft_status === 'running') {
    return NextResponse.json({ error: 'Draft already in progress' }, { status: 409 })
  }

  // Drafting implies approval — record it so the lifecycle reads correctly
  // even if the admin skipped the explicit Approve step.
  if (idea.status === 'suggested') {
    await supabase
      .from('resource_ideas')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', ideaId)
  }

  after(async () => {
    try {
      await generateResourceDraft(ideaId)
    } catch (err) {
      console.error('[resource-draft] Trigger failed:', err)
    }
  })

  return NextResponse.json({ success: true })
}
