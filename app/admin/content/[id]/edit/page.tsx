import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import EditorShell from '@/components/editor/EditorShell'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function EditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!UUID_RE.test(id)) notFound()

  const supabase = createServerClient()
  const { data: job } = await supabase
    .from('content_jobs')
    .select('id, session_id, phase, github_repo')
    .eq('session_id', id)
    .single()

  if (!job) notFound()
  if (job.phase < 6 || !job.github_repo) {
    redirect(`/admin/content/${id}`)
  }

  return <EditorShell sessionId={id} />
}
