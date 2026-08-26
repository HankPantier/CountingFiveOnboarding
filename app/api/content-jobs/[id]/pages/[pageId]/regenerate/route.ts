import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { generateSinglePage, finalizeGenerationIfComplete } from '@/lib/content/content-generator'

export const runtime = 'nodejs'
export const maxDuration = 120

// Re-run content generation for a single page from its already-approved
// outline. Resets admin_approved_content (handled inside generateSinglePage)
// so the admin re-reviews any newly produced copy.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const { id: _jobId } = await params
  const auth = await requireContentJobAccess(_jobId)
  if (auth instanceof NextResponse) return auth

  const { id, pageId } = await params
  const supabase = createServerClient()

  // pageId is the generated_pages id; map to its outline.
  const { data: genPage } = await supabase
    .from('generated_pages')
    .select('page_url')
    .eq('id', pageId)
    .eq('content_job_id', id)
    .single()
  if (!genPage) return NextResponse.json({ error: 'Page not found' }, { status: 404 })

  const { data: outline } = await supabase
    .from('page_outlines')
    .select('id, admin_approved')
    .eq('content_job_id', id)
    .eq('page_url', genPage.page_url)
    .single()
  if (!outline) return NextResponse.json({ error: 'Outline not found' }, { status: 404 })
  if (!outline.admin_approved) {
    return NextResponse.json({ error: 'Outline must be approved before regenerating' }, { status: 400 })
  }

  // after() gives Vercel's guarantee the work completes within maxDuration.
  // A bare fire-and-forget promise gets terminated once the response leaves the
  // function, which could strand the page 'running' until the sweep. The client
  // polls for the resulting status change.
  after(async () => {
    try {
      await generateSinglePage(id, outline.id)
      // Retrying the last stranded page can be what finally makes every page
      // terminal — advance to Deliverables so the job doesn't stay locked at
      // phase 5 just because completion happened outside the batch runner.
      await finalizeGenerationIfComplete(supabase, id)
    } catch (err) {
      console.error('[content-gen] Per-page regenerate failed:', err)
    }
  })

  return NextResponse.json({ success: true })
}
