import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'

// Each format maps to a persisted Storage object under the session's package
// folder, plus the attachment filename the browser should save it as.
const FORMATS = {
  zip: { file: 'content-package.zip', download: null },
  txt: { file: 'content-plain.txt', download: 'content-plain.txt' },
  docx: { file: 'content-plain.docx', download: 'content-plain.docx' },
} as const

type DownloadFormat = keyof typeof FORMATS

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _jobId } = await params
  const auth = await requireContentJobAccess(_jobId)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  const formatParam = new URL(req.url).searchParams.get('format') ?? 'zip'
  const format = (formatParam in FORMATS ? formatParam : 'zip') as DownloadFormat
  const { file, download } = FORMATS[format]

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

  const storagePath = `content-packages/${job.session_id}/${file}`

  const { data: signedUrl, error } = await supabase.storage
    .from('session-assets')
    // Plain files force a download (Content-Disposition) so browsers save the
    // .txt/.docx instead of rendering it inline.
    .createSignedUrl(storagePath, 3600, download ? { download } : undefined) // 60 minutes

  if (error || !signedUrl) {
    return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 })
  }

  return NextResponse.json({ url: signedUrl.signedUrl })
}
