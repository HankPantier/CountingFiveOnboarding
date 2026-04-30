import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import StatusBanner from '@/components/admin/StatusBanner'
import SchemaViewer from '@/components/admin/SchemaViewer'
import AssetsViewer from '@/components/admin/AssetsViewer'
import ApproveButton from '@/components/admin/ApproveButton'
import SendReminderButton from '@/components/admin/SendReminderButton'
import CopyLinkButton from '@/components/admin/CopyLinkButton'
import DeleteSessionButton from '@/components/admin/DeleteSessionButton'

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createServerClient()

  const [{ data: session }, { data: messages }, { data: assets }] = await Promise.all([
    supabase.from('sessions').select('*').eq('id', id).single(),
    supabase.from('messages').select('*').eq('session_id', id).order('created_at', { ascending: true }),
    supabase.from('assets').select('*').eq('session_id', id).order('uploaded_at', { ascending: true }),
  ])

  if (!session) notFound()

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left panel: chat transcript */}
      <div className="w-1/2 border-r border-border-default overflow-y-auto">
        <div className="px-6 py-4 border-b border-border-default bg-surface-subtle sticky top-0">
          <h2 className="text-sm font-heading font-semibold text-text-primary">Chat Transcript</h2>
          <p className="text-xs text-text-muted font-body mt-0.5">{session.website_url}</p>
        </div>
        <div className="p-6 space-y-3">
          {!messages?.length && (
            <p className="text-text-muted font-body text-sm italic">No messages yet.</p>
          )}
          {messages?.map(m => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={[
                  'max-w-[80%] rounded-2xl px-4 py-3 text-sm font-body',
                  m.role === 'user'
                    ? 'bg-brand-navy text-text-inverse'
                    : 'bg-surface-card text-text-primary border border-border-default',
                ].join(' ')}
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
                <p className={`text-xs mt-1 ${m.role === 'user' ? 'text-text-inverse/60' : 'text-text-muted'}`}>
                  {new Date(m.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel: schema + actions */}
      <div className="w-1/2 overflow-y-auto p-6">
        <StatusBanner session={session} />
        <CopyLinkButton sessionId={id} />
        <SchemaViewer sessionId={id} schemaData={session.schema_data} />
        <div className="mt-6">
          <AssetsViewer assets={assets ?? []} />
        </div>
        {session.pdf_url && (
          <div className="mt-4 flex flex-col gap-2">
            <a
              href={`/api/pdf/download?path=${encodeURIComponent(session.pdf_url)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
            >
              Download PDF
            </a>
            <a
              href={`/api/pdf/download?path=${encodeURIComponent(`pdfs/${id}/intake-summary.md`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
            >
              Download Markdown
            </a>
          </div>
        )}
        {session.status === 'completed' && (
          <ApproveButton sessionId={id} />
        )}
        {['pending', 'in_progress'].includes(session.status) && (
          <div className="mt-4">
            <SendReminderButton sessionId={id} />
          </div>
        )}
        <DeleteSessionButton sessionId={id} />
      </div>
    </div>
  )
}
