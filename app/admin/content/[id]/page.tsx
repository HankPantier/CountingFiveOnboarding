import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import PhaseStepper from '@/components/content/PhaseStepper'
import GithubRepoConnector from '@/components/admin/GithubRepoConnector'
import type { DesignTokens } from '@/types/design-tokens'
import type { SessionSchema } from '@/types/session-schema'
import type { NavJson } from '@/types/nav-json'

export default async function ContentWorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createServerClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('id, website_url, schema_data, status, approved_at')
    .eq('id', id)
    .single()

  if (!session || session.status !== 'approved') notFound()

  // Load or create content_job
  let { data: contentJob } = await supabase
    .from('content_jobs')
    .select('*')
    .eq('session_id', id)
    .single()

  if (!contentJob) {
    const { data: newJob, error: insertErr } = await supabase
      .from('content_jobs')
      .upsert({ session_id: id }, { onConflict: 'session_id' })
      .select('*')
      .single()
    if (insertErr) {
      // Race condition — another request created it, re-fetch
      const { data: refetched } = await supabase
        .from('content_jobs')
        .select('*')
        .eq('session_id', id)
        .single()
      contentJob = refetched
    } else {
      contentJob = newJob
    }
  }

  const firmName = (session.schema_data as Record<string, Record<string, unknown>>)?.business?.name as string | undefined
  const currentPhase = contentJob?.phase ?? 1
  const contentJobId = contentJob?.id ?? ''

  // Cumulative API cost for this job (estimated at insert time per model rates).
  const usageRows = contentJobId
    ? (await supabase
        .from('token_usage')
        .select('stage, input_tokens, output_tokens, cost_usd')
        .eq('content_job_id', contentJobId)).data ?? []
    : []
  const usage = usageRows.reduce(
    (acc, r) => {
      const cost = Number(r.cost_usd) || 0
      acc.cost += cost
      acc.tokens += (r.input_tokens || 0) + (r.output_tokens || 0)
      acc.calls += 1
      acc.byStage[r.stage] = (acc.byStage[r.stage] ?? 0) + cost
      return acc
    },
    { cost: 0, tokens: 0, calls: 0, byStage: {} as Record<string, number> }
  )
  const existingPalette = (contentJob?.palette ?? null) as import('@/types/palette').PaletteData | null
  const existingTokens = (contentJob?.design_tokens ?? null) as DesignTokens | null
  const brand = (session.schema_data as SessionSchema | null)?.brand
  const confirmedSitemap = (contentJob?.confirmed_sitemap ?? []) as Array<{ url: string; title: string; parent?: string; status?: string }>
  const confirmedPageCount = confirmedSitemap.length
  const navConfig = (contentJob?.nav_config ?? null) as NavJson | null

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <Link
          href="/admin/content"
          className="text-sm font-body text-text-muted hover:text-brand-cyan transition-colors"
        >
          &larr; Back to Content Hub
        </Link>

        <div className="mt-4">
          <h1 className="text-2xl font-heading font-bold text-brand-navy">
            {firmName ?? session.website_url}
          </h1>
          <p className="text-text-secondary font-body text-sm mt-1">
            {session.website_url}
            {session.approved_at && (
              <span className="ml-3 text-text-muted">
                Approved {new Date(session.approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )}
          </p>
          {usage.calls > 0 && (
            <p
              className="text-text-muted font-body text-xs mt-1"
              title={Object.entries(usage.byStage)
                .map(([stage, cost]) => `${stage}: $${cost.toFixed(2)}`)
                .join('  ·  ')}
            >
              Est. API cost: ${usage.cost.toFixed(2)} · {usage.tokens.toLocaleString()} tokens · {usage.calls} calls
            </p>
          )}
        </div>
      </div>

      <GithubRepoConnector
        contentJobId={contentJobId}
        initialRepo={contentJob?.github_repo ?? null}
        defaultOrg={process.env.GITHUB_ORG ?? null}
      />

      <PhaseStepper
        currentPhase={currentPhase}
        sessionId={session.id}
        contentJobId={contentJobId}
        existingPalette={existingPalette}
        existingTokens={existingTokens}
        brand={brand}
        confirmedPageCount={confirmedPageCount}
        navConfig={navConfig}
        confirmedSitemap={confirmedSitemap}
      />
    </main>
  )
}
