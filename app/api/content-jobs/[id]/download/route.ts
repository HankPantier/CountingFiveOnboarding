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

  // Get the session_id from content_job
  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id')
    .eq('id', id)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
  }

  const storagePath = `content-packages/${job.session_id}/content-package.zip`

  const { data: signedUrl, error } = await supabase.storage
    .from('session-assets')
    .createSignedUrl(storagePath, 3600) // 60 minutes

  if (error || !signedUrl) {
    return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 })
  }

  return NextResponse.json({ url: signedUrl.signedUrl })
}
