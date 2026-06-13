import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { buildAuditHtml } from '@/lib/audit/html-report'
import type { AuditResult, CategoryScoreMap } from '@/types/audit-result'

export const runtime = 'nodejs'

// GET /api/audits/[id]/export — download a self-contained, shareable HTML report.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = createServerClient()
  const { data: run } = await supabase.from('audit_runs').select('*').eq('id', id).single()

  if (!run) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  if (run.audit_status !== 'complete' || !run.result) {
    return NextResponse.json({ error: 'Audit is not complete' }, { status: 409 })
  }

  // Previous completed run for the same domain → score deltas in the export.
  const { data: prev } = await supabase
    .from('audit_runs')
    .select('overall_score, category_scores')
    .eq('domain', run.domain)
    .eq('audit_status', 'complete')
    .lt('created_at', run.created_at)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const html = buildAuditHtml({
    result: run.result as unknown as AuditResult,
    createdAt: run.created_at,
    previous: prev
      ? {
          overall_score: prev.overall_score,
          category_scores: (prev.category_scores as CategoryScoreMap | null) ?? null,
        }
      : null,
  })

  const safeDomain = run.domain.replace(/[^a-zA-Z0-9.-]/g, '-')
  const date = run.created_at.slice(0, 10)
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-${safeDomain}-${date}.html"`,
    },
  })
}
