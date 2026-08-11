import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuditorCapability, getAccessibleAuditScope } from '@/lib/auth/access'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { createServerClient } from '@/lib/supabase/server'
import { runAuditBatch } from '@/lib/audit/batch-runner'
import { parseBatchUrls, MAX_BATCH_URLS } from '@/lib/audit/parse-batch-urls'
import { resolveInheritedGroup } from '@/lib/audit/audit-group'

export const runtime = 'nodejs'
export const maxDuration = 600

const RUNNING_STATES = ['crawling', 'analyzing', 'researching', 'scoring', 'rendering']

const CreateBatchSchema = z.object({
  // Either a raw textarea blob or a pre-split array; parseBatchUrls handles both.
  text: z.string().max(20_000).optional(),
  urls: z.array(z.string().max(2000)).max(500).optional(),
  label: z.string().max(200).optional(),
  maxPages: z.number().int().min(1).max(250).optional(),
})

// POST /api/audit-batches — queue many URLs as one sequential batch.
export async function POST(req: Request) {
  const auth = await requireAuditorCapability()
  if (auth instanceof NextResponse) return auth

  // Batch-aware throttle: a whole batch counts as one event, so the per-audit
  // 20/hr limit (app/api/audits) never applies inside a batch. 10 batches/day
  // caps worst-case spend (10 × 25 audits) while staying out of the way.
  if (!(await checkRateLimit(`audit-batch-create:${auth.user.id}`, 10, 24 * 60 * 60 * 1000))) {
    return NextResponse.json({ error: 'Batch limit reached — try again later' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = CreateBatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const source = parsed.data.urls ?? parsed.data.text ?? ''
  const { valid, invalid } = parseBatchUrls(source)

  if (valid.length === 0) {
    return NextResponse.json({ error: 'No valid URLs found' }, { status: 400 })
  }
  if (valid.length > MAX_BATCH_URLS) {
    return NextResponse.json(
      { error: `Too many URLs — ${valid.length} found, limit is ${MAX_BATCH_URLS}` },
      { status: 400 },
    )
  }

  const supabase = createServerClient()
  const maxPages = parsed.data.maxPages ?? 80
  const label = parsed.data.label?.trim() || null

  const { data: batch, error: batchErr } = await supabase
    .from('audit_batches')
    .insert({ label, total_count: valid.length, created_by: auth.user.id, status: 'running' })
    .select('id')
    .single()

  if (batchErr || !batch) {
    console.error('[audit-batch] create failed:', batchErr?.message)
    return NextResponse.json({ error: 'Failed to create batch' }, { status: 500 })
  }

  // Folders track the business: each queued run inherits its site's current
  // folder (resolve once per unique domain).
  const uniqueDomains = [...new Set(valid.map((v) => v.domain))]
  const groupByDomain = new Map<string, string>()
  await Promise.all(
    uniqueDomains.map(async (d) => {
      groupByDomain.set(d, await resolveInheritedGroup(supabase, { domain: d, createdBy: auth.user.id }))
    }),
  )

  const { error: runsErr } = await supabase.from('audit_runs').insert(
    valid.map((v) => ({
      created_by: auth.user.id,
      url: v.url,
      domain: v.domain,
      max_pages: maxPages,
      audit_status: 'queued',
      audit_batch_id: batch.id,
      audit_group: groupByDomain.get(v.domain) ?? 'prospect',
    })),
  )

  if (runsErr) {
    console.error('[audit-batch] failed to queue runs:', runsErr.message)
    // Roll the batch back so we never leave an empty running batch behind.
    await supabase.from('audit_batches').delete().eq('id', batch.id)
    return NextResponse.json({ error: 'Failed to queue audits' }, { status: 500 })
  }

  after(async () => {
    try {
      await runAuditBatch(batch.id)
    } catch (err) {
      console.error('[audit-batch] Trigger failed:', err)
    }
  })

  return NextResponse.json({ id: batch.id, count: valid.length, invalid: invalid.length })
}

interface AuditBatchListItem {
  id: string
  label: string | null
  status: string
  total_count: number
  created_at: string
  counts: { queued: number; running: number; complete: number; error: number }
}

// GET /api/audit-batches — list batches (newest first) with rolled-up counts.
export async function GET() {
  const auth = await requireAuditorCapability()
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  // Auditors see only batches they created; admins see all.
  const scope = getAccessibleAuditScope(auth.user)
  let listQuery = supabase
    .from('audit_batches')
    .select('id, label, status, total_count, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (scope) listQuery = listQuery.eq('created_by', scope.createdBy)
  const { data: batches, error } = await listQuery

  if (error) {
    console.error('[audit-batch] list failed:', error.message)
    return NextResponse.json({ error: 'Failed to list batches' }, { status: 500 })
  }

  const ids = (batches ?? []).map((b) => b.id)
  const { data: runs } = ids.length
    ? await supabase.from('audit_runs').select('audit_batch_id, audit_status').in('audit_batch_id', ids)
    : { data: [] }

  const countsByBatch = new Map<string, AuditBatchListItem['counts']>()
  for (const r of runs ?? []) {
    if (!r.audit_batch_id) continue
    const c = countsByBatch.get(r.audit_batch_id) ?? { queued: 0, running: 0, complete: 0, error: 0 }
    if (r.audit_status === 'queued') c.queued += 1
    else if (r.audit_status === 'complete') c.complete += 1
    else if (r.audit_status === 'error') c.error += 1
    else if (RUNNING_STATES.includes(r.audit_status)) c.running += 1
    countsByBatch.set(r.audit_batch_id, c)
  }

  const items: AuditBatchListItem[] = (batches ?? []).map((b) => ({
    ...b,
    counts: countsByBatch.get(b.id) ?? { queued: 0, running: 0, complete: 0, error: 0 },
  }))

  return NextResponse.json({ batches: items })
}
