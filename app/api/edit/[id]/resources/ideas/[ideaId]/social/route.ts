import { after, NextResponse } from 'next/server'
import { resolveEditContext } from '../../../../_helpers'
import { createServerClient } from '@/lib/supabase/server'
import { generateSocialContent } from '@/lib/content/social-generator'

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
    .select('id, status, slug, social_status')
    .eq('id', ideaId)
    .eq('content_job_id', ctx.jobId)
    .single()
  if (!idea) {
    return NextResponse.json({ error: 'Idea not found' }, { status: 404 })
  }
  if (idea.status !== 'drafted' || !idea.slug) {
    return NextResponse.json({ error: 'Idea has no drafted post yet' }, { status: 409 })
  }
  // Fast-path rejection for double-clicks; the generator's atomic claim
  // (social_status → running via .neq guard) is the authoritative guard.
  if (idea.social_status === 'running') {
    return NextResponse.json({ error: 'Social generation already running' }, { status: 409 })
  }

  after(async () => {
    try {
      await generateSocialContent(ideaId)
    } catch (err) {
      console.error('[social-gen] Trigger failed:', err)
    }
  })

  return NextResponse.json({ success: true })
}
