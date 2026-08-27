import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { INDUSTRY_OPTIONS, isIndustry } from '@/lib/content/industries'
import { inferSessionIndustry } from '@/lib/content/infer-industry'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SELECTIONS = 50
const MAX_LIBRARY_ROWS = 300

// GET — the bulk/library content an operator can include in this new site, and
// which items are already selected. Defaults the industry filter to the client's
// inferred vertical; `?industry=all` returns every vertical.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireContentJobAccess(id)
  if (ctx instanceof NextResponse) return ctx

  const supabase = createServerClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', ctx.sessionId)
    .single()
  const inferred = inferSessionIndustry((session?.schema_data ?? {}) as SessionSchema)

  const url = new URL(req.url)
  const industryParam = url.searchParams.get('industry')
  const showAll = industryParam === 'all'
  const industry = !showAll && industryParam && isIndustry(industryParam) ? industryParam : inferred

  let query = supabase
    .from('blog_batches')
    .select('id, title, angle, content_type, industry, created_at')
    .order('created_at', { ascending: false })
    .limit(MAX_LIBRARY_ROWS)
  if (!showAll) query = query.eq('industry', industry)
  const { data: batches, error } = await query
  if (error) {
    console.error('[library] Failed to load blog_batches:', error.message)
    return NextResponse.json({ error: 'Failed to load library content' }, { status: 500 })
  }

  const { data: selections } = await supabase
    .from('content_job_library_selections')
    .select('batch_id')
    .eq('content_job_id', id)
  const selectedBatchIds = (selections ?? []).map((s) => s.batch_id)

  return NextResponse.json({
    inferredIndustry: inferred,
    industry: showAll ? 'all' : industry,
    industries: INDUSTRY_OPTIONS,
    batches: batches ?? [],
    selectedBatchIds,
  })
}

interface SaveBody {
  batchIds?: string[]
}

// POST — record which library items to include (idempotent replace). The actual
// re-draft is deferred to Deliverables (phase 6), when the repo exists. Only
// 'pending' selections are reconciled here — once a selection has started
// drafting (phase 6) it is immutable to a late phase-4 edit.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireContentJobAccess(id)
  if (ctx instanceof NextResponse) return ctx

  let body: SaveBody
  try {
    body = (await req.json()) as SaveBody
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const rawIds = Array.isArray(body.batchIds) ? body.batchIds : []
  const batchIds = [...new Set(rawIds.filter((v) => typeof v === 'string' && UUID_RE.test(v)))]
  if (batchIds.length > MAX_SELECTIONS) {
    return NextResponse.json({ error: `Select ${MAX_SELECTIONS} items or fewer` }, { status: 400 })
  }

  const supabase = createServerClient()

  // Validate the batches exist (a stale client could send deleted ids).
  let validIds: string[] = []
  if (batchIds.length) {
    const { data: found } = await supabase.from('blog_batches').select('id').in('id', batchIds)
    validIds = (found ?? []).map((b) => b.id)
  }

  // Drop pending selections the operator deselected.
  const delQuery = supabase
    .from('content_job_library_selections')
    .delete()
    .eq('content_job_id', id)
    .eq('status', 'pending')
  const { error: delErr } = validIds.length
    ? await delQuery.not('batch_id', 'in', `(${validIds.join(',')})`)
    : await delQuery
  if (delErr) {
    console.error('[library] Failed to prune selections:', delErr.message)
    return NextResponse.json({ error: 'Failed to save selections' }, { status: 500 })
  }

  if (validIds.length) {
    const { error: upErr } = await supabase
      .from('content_job_library_selections')
      .upsert(
        validIds.map((batchId) => ({
          content_job_id: id,
          session_id: ctx.sessionId,
          batch_id: batchId,
          status: 'pending',
        })),
        { onConflict: 'content_job_id,batch_id', ignoreDuplicates: true }
      )
    if (upErr) {
      console.error('[library] Failed to upsert selections:', upErr.message)
      return NextResponse.json({ error: 'Failed to save selections' }, { status: 500 })
    }
  }

  return NextResponse.json({ saved: validIds.length })
}
