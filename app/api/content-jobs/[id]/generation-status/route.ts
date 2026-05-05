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

  const { data: pages, error } = await supabase
    .from('generated_pages')
    .select('page_url, page_title, generation_status')
    .eq('content_job_id', id)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const all = pages ?? []
  return NextResponse.json({
    total: all.length,
    complete: all.filter(p => p.generation_status === 'complete').length,
    running: all.filter(p => p.generation_status === 'running').length,
    error: all.filter(p => p.generation_status === 'error').length,
    pages: all.map(p => ({
      url: p.page_url,
      title: p.page_title,
      status: p.generation_status,
    })),
  })
}
