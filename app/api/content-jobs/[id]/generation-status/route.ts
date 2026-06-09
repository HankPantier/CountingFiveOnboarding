import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _jobId } = await params
  const auth = await requireContentJobAccess(_jobId)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = createServerClient()

  const [{ data: pages, error }, { data: job }] = await Promise.all([
    supabase
      .from('generated_pages')
      .select('id, page_url, page_title, generation_status, admin_approved_content, needs_client_review, client_approved_content, word_count_actual, word_count_target')
      .eq('content_job_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('content_jobs')
      .select('confirmed_sitemap')
      .eq('id', id)
      .single(),
  ])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const sitemap = (job?.confirmed_sitemap ?? []) as Array<{ url: string; parent?: string }>
  const parentByUrl = new Map(sitemap.map(p => [p.url, p.parent]))

  const all = pages ?? []
  return NextResponse.json({
    total: all.length,
    complete: all.filter(p => p.generation_status === 'complete').length,
    running: all.filter(p => p.generation_status === 'running').length,
    error: all.filter(p => p.generation_status === 'error').length,
    approved: all.filter(p => p.generation_status === 'complete' && p.admin_approved_content).length,
    needsClientReview: all.filter(p => p.needs_client_review).length,
    clientApproved: all.filter(p => p.needs_client_review && p.client_approved_content).length,
    pages: all.map(p => ({
      id: p.id,
      url: p.page_url,
      title: p.page_title,
      status: p.generation_status,
      parent: parentByUrl.get(p.page_url),
      approved: p.admin_approved_content,
      needsClientReview: p.needs_client_review,
      clientApproved: p.client_approved_content,
      wordCountActual: p.word_count_actual,
      wordCountTarget: p.word_count_target,
    })),
  })
}
