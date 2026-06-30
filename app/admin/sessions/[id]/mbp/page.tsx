import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds } from '@/lib/auth/access'
import { buildMbpDocument } from '@/lib/mbp/build-document'
import MbpDocument from '@/components/admin/mbp/MbpDocument'
import MbpDeepLinkFocus from '@/components/admin/mbp/MbpDeepLinkFocus'
import MbpCompleteness from '@/components/admin/mbp/MbpCompleteness'
import MbpSuggestions from '@/components/admin/mbp/MbpSuggestions'
import MbpBackfillButton from '@/components/admin/mbp/MbpBackfillButton'
import MbpChatModal from '@/components/admin/mbp/MbpChatModal'
import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'
import type { MbpSuggestion } from '@/types/mbp'

export default async function MbpPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (user.role !== 'admin') {
    const allowed = await getAccessibleSessionIds(user)
    if (!allowed?.includes(id)) notFound()
  }
  const isAdmin = user.role === 'admin'

  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('id, website_url, schema_data, gap_list, mbp_content')
    .eq('id', id)
    .single()
  if (!session) notFound()

  const schema = (session.schema_data ?? {}) as SessionSchema
  const gaps = (session.gap_list as GapItem[]) ?? []

  // The live site structure is the content job's confirmed_sitemap (what the
  // generated content was built from), not the stale onboarding sitemaps.
  const { data: job } = await supabase
    .from('content_jobs')
    .select('confirmed_sitemap')
    .eq('session_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const confirmedSitemap = (job?.confirmed_sitemap ?? null) as SessionSchema['proposed_sitemap'] | null

  const doc = buildMbpDocument(schema, confirmedSitemap)
  const overrides =
    ((schema._meta?.admin_overrides as Record<string, boolean> | undefined)) ?? {}

  const { data: suggestionRows } = await supabase
    .from('mbp_suggestions')
    .select('*')
    .eq('session_id', id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  const suggestions = (suggestionRows ?? []) as unknown as MbpSuggestion[]

  let initialMessages: { role: string; content: string }[] = []
  if (isAdmin) {
    const { data: msgs } = await supabase
      .from('mbp_messages')
      .select('role, content')
      .eq('session_id', id)
      .order('created_at', { ascending: true })
    initialMessages = msgs ?? []
  }

  return (
    <main className="p-8 space-y-6">
      <MbpDeepLinkFocus />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold text-brand-navy">Master Business Profile</h1>
          <p className="text-text-secondary font-body text-sm mt-1">{session.website_url}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && <MbpBackfillButton sessionId={id} />}
          {isAdmin && <MbpChatModal sessionId={id} initialMessages={initialMessages} />}
          <Link
            href={`/admin/sessions/${id}`}
            className="border border-border-default text-text-secondary font-heading font-semibold text-xs px-3.5 py-1.5.5 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy"
          >
            ← Session
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <MbpCompleteness doc={doc} gaps={gaps} />
        <MbpSuggestions sessionId={id} suggestions={suggestions} isAdmin={isAdmin} />
      </div>

      {/* Original analyst MBP doc (only present for MBP-upload sessions; audit
          sessions have none). Read-only, for traceability — schema_data is the
          source of truth and may have diverged via edits since import. */}
      {session.mbp_content && (
        <details className="border border-border-default rounded-lg overflow-hidden">
          <summary className="px-4 py-2.5 bg-surface-subtle text-sm font-heading font-semibold text-text-primary cursor-pointer">
            View original analyst doc
          </summary>
          <pre className="px-4 py-3 text-xs font-mono text-text-secondary whitespace-pre-wrap break-words max-h-[32rem] overflow-y-auto">
            {session.mbp_content}
          </pre>
        </details>
      )}

      <MbpDocument doc={doc} overrides={overrides} sessionId={id} editable={isAdmin} />
    </main>
  )
}
