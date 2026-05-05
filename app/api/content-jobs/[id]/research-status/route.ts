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

  const { data: results, error } = await supabase
    .from('research_results')
    .select('page_url, page_title, research_status')
    .eq('content_job_id', id)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const pages = results ?? []
  const total = pages.length
  const complete = pages.filter(p => p.research_status === 'complete').length
  const running = pages.filter(p => p.research_status === 'running').length
  const errorCount = pages.filter(p => p.research_status === 'error').length

  return NextResponse.json({
    total,
    complete,
    running,
    error: errorCount,
    pages: pages.map(p => ({
      url: p.page_url,
      title: p.page_title,
      status: p.research_status,
    })),
  })
}
