import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { savePricingPlans } from '@/lib/content/pricing-plans-config'
import {
  loadPricingPlansForSession,
  syncPricingPlansToRepo,
} from '@/lib/content/pricing-plans-repo-sync'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PutBody {
  config?: unknown
  enabled?: boolean
}

// Load the session's pricing plans (DB row → repo file → default).
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

  const record = await loadPricingPlansForSession(sessionId)
  return NextResponse.json({
    config: record.config,
    enabled: record.enabled,
    exists: record.exists,
    published: record.published,
  })
}

// Upsert the config + enabled flag. For published clients, also push the plans
// page to the repo draft branch so it reaches the live site on publish.
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

  const enabled = body.enabled !== false // default true
  let config
  try {
    config = await savePricingPlans(sessionId, body.config, enabled, auth.user.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // Push to the repo for published clients so the change reaches the site.
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
    const { data: session } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', sessionId)
      .single()
    const firmName = ((session?.schema_data ?? {}) as SessionSchema).business?.name ?? 'the firm'
    const result = await syncPricingPlansToRepo({
      githubRepo: job.github_repo,
      config,
      enabled,
      firmName,
      actor: { name: auth.user.name, email: auth.user.email },
    })
    synced = result.ok
    syncError = result.error
  }

  return NextResponse.json({ config, enabled, exists: true, published, synced, syncError })
}
