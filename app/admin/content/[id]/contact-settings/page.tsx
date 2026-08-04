import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds } from '@/lib/auth/access'
import { loadSiteSettingsForSession } from '@/lib/content/site-settings-repo-sync'
import ContactSettingsEditor from '@/components/content/ContactSettingsEditor'
import type { SessionSchema } from '@/types/session-schema'

export default async function ContactSettingsPage({
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

  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('id, website_url, schema_data')
    .eq('id', id)
    .single()
  if (!session) notFound()

  const record = await loadSiteSettingsForSession(id)
  const firmName = (session.schema_data as SessionSchema | null)?.business?.name

  return (
    <main className="p-8 max-w-[900px] mx-auto">
      <div className="mb-8">
        <Link
          href={record.published ? `/admin/content/${id}/edit` : `/admin/content/${id}`}
          className="text-sm font-body text-text-muted hover:text-brand-cyan transition-colors"
        >
          &larr; Back to {record.published ? 'content editor' : 'content workflow'}
        </Link>
        <div className="mt-4">
          <h1 className="text-2xl font-heading font-bold text-brand-navy">Contact &amp; scheduling</h1>
          <p className="text-text-secondary font-body text-sm mt-1">
            {firmName ?? session.website_url} · the booking link behind the site&rsquo;s contact drawer
          </p>
        </div>
      </div>

      <ContactSettingsEditor
        sessionId={id}
        initial={{ bookingProvider: record.bookingProvider, bookingUrl: record.bookingUrl }}
        published={record.published}
      />
    </main>
  )
}
