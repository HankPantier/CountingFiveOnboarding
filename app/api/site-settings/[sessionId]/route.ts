import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { saveSiteSettings } from '@/lib/content/site-settings'
import {
  loadSiteSettingsForSession,
  syncSiteSettingsToRepo,
} from '@/lib/content/site-settings-repo-sync'

export const runtime = 'nodejs'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PutBody {
  bookingProvider?: unknown
  bookingUrl?: unknown
}

// Load the session's site settings (DB row → repo site.config → default).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }
  const auth = await requireSessionAccess(sessionId)
  if (auth instanceof NextResponse) return auth

  const record = await loadSiteSettingsForSession(sessionId)
  return NextResponse.json({
    bookingProvider: record.bookingProvider,
    bookingUrl: record.bookingUrl,
    exists: record.exists,
    published: record.published,
  })
}

// Save booking config; for published clients also patch the repo site.config.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }
  const auth = await requireSessionAccess(sessionId)
  if (auth instanceof NextResponse) return auth

  let body: PutBody
  try {
    body = (await req.json()) as PutBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let settings
  try {
    settings = await saveSiteSettings(sessionId, body, auth.user.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const supabase = createServerClient()
  const { data: job } = await supabase
    .from('content_jobs')
    .select('github_repo, phase')
    .eq('session_id', sessionId)
    .maybeSingle()
  const published = !!job?.github_repo && (job?.phase ?? 0) >= 6

  let synced = false
  let syncError: string | undefined
  if (published && job?.github_repo) {
    const result = await syncSiteSettingsToRepo({
      githubRepo: job.github_repo,
      settings,
      actor: { name: auth.user.name, email: auth.user.email },
    })
    synced = result.ok
    syncError = result.error
  }

  return NextResponse.json({ ...settings, published, synced, syncError })
}
