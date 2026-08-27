import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getSiteOwnerSessionId, isSiteOwner } from '@/lib/auth/access'
import EditorShell from '@/components/editor/EditorShell'
import type { SessionSchema } from '@/types/session-schema'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function EditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ path?: string }>
}) {
  const { id } = await params
  if (!UUID_RE.test(id)) notFound()

  // A Site Owner may only reach their own site's editor — bounce any other URL
  // back to theirs. (The /api/edit routes also 403 cross-site; this is UX.)
  const user = await getCurrentUser()
  const viewerIsOwner = !!user && isSiteOwner(user)
  if (viewerIsOwner) {
    const ownedSessionId = await getSiteOwnerSessionId(user)
    if (ownedSessionId && ownedSessionId !== id) {
      redirect(`/admin/content/${ownedSessionId}/edit`)
    }
  }

  // Optional deep-link to a specific file (Batch Content "Open draft"). The file
  // API validates/normalizes the path server-side; we only sanity-check it
  // points at a content file before forwarding it to the editor.
  const { path } = await searchParams
  const initialPath = typeof path === 'string' && path.startsWith('content/') ? path : undefined

  const supabase = createServerClient()
  const [{ data: job }, { data: session }] = await Promise.all([
    supabase
      .from('content_jobs')
      .select('id, session_id, phase, github_repo')
      .eq('session_id', id)
      .single(),
    supabase
      .from('sessions')
      .select('website_url, schema_data')
      .eq('id', id)
      .single(),
  ])

  if (!job) notFound()
  if (job.phase < 6 || !job.github_repo) {
    redirect(`/admin/content/${id}`)
  }

  const schema = (session?.schema_data ?? null) as SessionSchema | null
  const firmName = schema?.business?.name?.trim() || session?.website_url || 'Untitled client'
  const websiteUrl = session?.website_url ?? ''

  return (
    <EditorShell
      sessionId={id}
      firmName={firmName}
      websiteUrl={websiteUrl}
      initialPath={initialPath}
      viewerIsOwner={viewerIsOwner}
    />
  )
}
