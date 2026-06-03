import { NextResponse } from 'next/server'
import { resolveEditContext } from '../../_helpers'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  const supabase = createServerClient()
  const { data: ideas, error } = await supabase
    .from('resource_ideas')
    .select(
      'id, title, angle, target_keyword, secondary_keywords, rationale, score, score_breakdown, external_links, status, draft_status, slug, draft_path, draft_error, created_at'
    )
    .eq('content_job_id', ctx.jobId)
    .order('score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ideas: ideas ?? [] })
}
