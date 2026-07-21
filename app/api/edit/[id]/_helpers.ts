import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type EditContext = {
  adminEmail: string | undefined
  adminName: string | undefined
  jobId: string
  sessionId: string
  githubRepo: string
}

// Resolve [id] (session UUID) into a content_jobs row, enforce that the
// editor preconditions are met (phase ≥ 6, github_repo set), and return the
// admin's email for commit attribution. Returns a NextResponse to short-circuit
// the caller on any failure.
export async function resolveEditContext(
  paramId: string
): Promise<EditContext | NextResponse> {
  if (!UUID_RE.test(paramId)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }
  const auth = await requireSessionAccess(paramId)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  const { data: job } = await supabase
    .from('content_jobs')
    .select('id, session_id, phase, github_repo')
    .eq('session_id', paramId)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
  }
  if (job.phase < 6) {
    return NextResponse.json(
      { error: 'Content has not been published yet' },
      { status: 409 }
    )
  }
  if (!job.github_repo) {
    return NextResponse.json(
      { error: 'Repo not provisioned for this session' },
      { status: 409 }
    )
  }

  return {
    adminEmail: auth.user.email,
    adminName: auth.user.name,
    jobId: job.id,
    sessionId: job.session_id,
    githubRepo: job.github_repo,
  }
}
