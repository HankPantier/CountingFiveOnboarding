import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds } from '@/lib/auth/access'
import { buildMbpDocument } from '@/lib/mbp/build-document'
import MbpDocument from '@/components/admin/mbp/MbpDocument'
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
    .select('id, website_url, schema_data, gap_list')
    .eq('id', id)
    .single()
  if (!session) notFound()

  const schema = (session.schema_data ?? {}) as SessionSchema
  const gaps = (session.gap_list as GapItem[]) ?? []
  const doc = buildMbpDocument(schema)
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
            className="border border-border-default text-text-secondary font-heading font-semibold text-sm px-5 py-2.5 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy"
          >
            ← Session
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <MbpCompleteness doc={doc} gaps={gaps} />
        <MbpSuggestions sessionId={id} suggestions={suggestions} isAdmin={isAdmin} />
      </div>

      <MbpDocument doc={doc} overrides={overrides} sessionId={id} editable={isAdmin} />
    </main>
  )
}
