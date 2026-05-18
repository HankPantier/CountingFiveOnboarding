import { createServerClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import ClientReviewList from '@/components/content/ClientReviewList'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // Validate UUID format
  if (!UUID_REGEX.test(id)) {
    notFound()
  }

  const supabase = createServerClient()

  // Load the content job
  const { data: job, error: jobError } = await supabase
    .from('content_jobs')
    .select('id, session_id')
    .eq('id', id)
    .single()

  if (jobError || !job) {
    notFound()
  }

  // Load the session to get firm name
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', job.session_id)
    .single()

  if (sessionError || !session) {
    notFound()
  }

  // Extract firm name defensively
  const firmName =
    session.schema_data && typeof session.schema_data === 'object'
      ? (session.schema_data as any).business?.name || 'your firm'
      : 'your firm'

  // Load flagged pages for review
  const { data: pages } = await supabase
    .from('generated_pages')
    .select('id, page_url, page_title, word_count_actual, word_count_target, client_approved_content')
    .eq('content_job_id', id)
    .eq('needs_client_review', true)
    .eq('generation_status', 'complete')
    .order('created_at', { ascending: true })

  return (
    <div className="min-h-screen bg-surface-page">
      {/* Header — matches /session/[id] chrome */}
      <header className="bg-brand-navy flex-shrink-0">
        <div className="h-16 flex items-center justify-between px-6">
          <Image
            src="/logo-white.png"
            alt="CountingFive"
            height={32}
            width={180}
            className="h-8 w-auto"
            priority
          />
          <span className="text-white/60 text-xs font-body hidden sm:block">
            Content review
          </span>
        </div>
      </header>

      {/* Page content */}
      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-heading font-bold text-brand-navy">
            Review your content
          </h1>
          <p className="mt-2 text-text-secondary font-body text-sm">
            Hi {firmName} — your CountingFive team has prepared the pages below
            for your review. You can read each one, make edits if anything needs
            changing, and approve when it&apos;s ready. Take your time; you don&apos;t
            need to do this all at once.
          </p>
        </div>

        <div className="text-xs font-body text-text-muted bg-surface-subtle border border-border-default rounded-lg px-4 py-2">
          This is a private link for you. Please don&apos;t share it — it gives
          access to edit your draft pages.
        </div>

        <ClientReviewList contentJobId={job.id} pages={pages || []} />
      </main>
    </div>
  )
}
