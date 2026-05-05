import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import PhaseStepper from '@/components/content/PhaseStepper'

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
  const existingPalette = (contentJob?.palette ?? null) as import('@/types/palette').PaletteData | null
  const confirmedSitemap = (contentJob?.confirmed_sitemap ?? []) as Array<unknown>
  const confirmedPageCount = confirmedSitemap.length

  return (
    <main className="p-8 max-w-3xl mx-auto">
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
        </div>
      </div>

      <PhaseStepper
        currentPhase={currentPhase}
        sessionId={session.id}
        contentJobId={contentJobId}
        existingPalette={existingPalette}
        confirmedPageCount={confirmedPageCount}
      />
    </main>
  )
}
