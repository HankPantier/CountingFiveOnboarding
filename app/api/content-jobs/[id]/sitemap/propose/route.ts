import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { proposeSitemap } from '@/lib/content/sitemap-proposer'
import { asJson } from '@/lib/supabase/json-typed'
import type { SessionSchema } from '@/types/session-schema'
import type { AuditResult } from '@/types/audit-result'

export const runtime = 'nodejs'
export const maxDuration = 120

// Regenerate the proposed sitemap with the AI proposer (template skeleton + AI
// enrichment). Writes the result to sessions.schema_data.proposed_sitemap and
// clears confirmed_sitemap so the Sitemap phase serves the fresh proposal.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireContentJobAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()

  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id')
    .eq('id', id)
    .single()
  if (!job) {
    return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
  }
  const sessionId = job.session_id

  const [{ data: session }, { data: auditRun }] = await Promise.all([
    supabase.from('sessions').select('schema_data').eq('id', sessionId).single(),
    supabase
      .from('audit_runs')
      .select('result')
      .eq('session_id', sessionId)
      .eq('audit_status', 'complete')
      .maybeSingle(),
  ])

  const schema = (session?.schema_data ?? {}) as SessionSchema
  const auditResult = (auditRun?.result ?? null) as AuditResult | null

  const pages = await proposeSitemap(schema, auditResult, { sessionId, contentJobId: id })

  const updatedSchema: SessionSchema = { ...schema, proposed_sitemap: pages }
  const { error: schemaErr } = await supabase
    .from('sessions')
    .update({ schema_data: asJson(updatedSchema), updated_at: new Date().toISOString() })
    .eq('id', sessionId)
  if (schemaErr) {
    return NextResponse.json({ error: schemaErr.message }, { status: 500 })
  }

  // Drop any prior confirmation so GET serves the new proposal for re-review.
  await supabase
    .from('content_jobs')
    .update({ confirmed_sitemap: null, updated_at: new Date().toISOString() })
    .eq('id', id)

  console.warn(`[content-job] AI sitemap proposed job=${id} pages=${pages.length}`)
  return NextResponse.json({ pages, count: pages.length })
}
