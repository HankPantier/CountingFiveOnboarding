import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { runContentGeneration } from '@/lib/content/content-generator'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = createServerClient()

  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id')
    .eq('id', id)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
  }

  // Fire-and-forget
  runContentGeneration(id, job.session_id).catch(err =>
    console.error('[content-gen] Manual trigger failed:', err)
  )

  return NextResponse.json({ success: true })
}
