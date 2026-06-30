import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds } from '@/lib/auth/access'
import StatusBanner from '@/components/admin/StatusBanner'
import SchemaViewer from '@/components/admin/SchemaViewer'
import AssetsViewer from '@/components/admin/AssetsViewer'
import TeamPhotoManager from '@/components/admin/TeamPhotoManager'
import StockPhotoManager from '@/components/admin/StockPhotoManager'
import ApproveButton from '@/components/admin/ApproveButton'
import MarkCompleteButton from '@/components/admin/MarkCompleteButton'
import RegenerateMbpButton from '@/components/admin/RegenerateMbpButton'
import SendReminderButton from '@/components/admin/SendReminderButton'
import CopyLinkButton from '@/components/admin/CopyLinkButton'
import DeleteSessionButton from '@/components/admin/DeleteSessionButton'
import { ReauditButton } from '@/components/admin/audit/ReauditButton'

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // Managers may only open clients assigned to them.
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (user.role !== 'admin') {
    const allowed = await getAccessibleSessionIds(user)
    if (!allowed?.includes(id)) notFound()
  }
  const isAdmin = user.role === 'admin'

  const supabase = createServerClient()

  const [{ data: session }, { data: messages }, { data: assets }, { data: sourceAudit }, { data: contentJob }] =
    await Promise.all([
      supabase.from('sessions').select('*').eq('id', id).single(),
      supabase.from('messages').select('*').eq('session_id', id).order('created_at', { ascending: true }),
      supabase.from('assets').select('*').eq('session_id', id).order('uploaded_at', { ascending: true }),
      supabase.from('audit_runs').select('id, domain, url').eq('session_id', id).maybeSingle(),
      supabase.from('content_jobs').select('phase').eq('session_id', id).maybeSingle(),
    ])

  if (!session) notFound()

  // Sign URLs for every asset server-side so the components never need to
  // know the bucket is private. 1-hour expiry covers a typical admin
  // session; refreshing the page mints new URLs via router.refresh().
  const signedUrls: Record<string, string> = {}
  for (const asset of assets ?? []) {
    if (!asset.storage_path) continue
    const { data: signed } = await supabase.storage
      .from('session-assets')
      .createSignedUrl(asset.storage_path, 3600)
    if (signed?.signedUrl) signedUrls[asset.id] = signed.signedUrl
  }

  return (
    <div className="flex flex-col md:flex-row md:h-[calc(100vh-4rem)]">
      {/* Left panel: chat transcript */}
      <div className="md:w-1/2 max-h-[50vh] md:max-h-none border-b md:border-b-0 md:border-r border-border-default overflow-y-auto">
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
      <div className="md:w-1/2 overflow-y-auto p-6">
        <StatusBanner session={session} />
        {sourceAudit && (
          <Link
            href={`/admin/audits/${sourceAudit.id}`}
            className="mb-3 inline-block font-body text-sm text-brand-cyan hover:underline"
          >
            ← Started from audit: {sourceAudit.domain}
          </Link>
        )}
        {sourceAudit && contentJob?.phase === 6 && <ReauditButton url={sourceAudit.url} />}
        <CopyLinkButton sessionId={id} />
        <Link
          href={`/admin/sessions/${id}/mbp`}
          className="inline-flex items-center gap-2 mt-2 text-sm font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
        >
          View Master Business Profile &rarr;
        </Link>
        <SchemaViewer sessionId={id} schemaData={session.schema_data} readOnly={!isAdmin} />
        <div className="mt-6">
          <TeamPhotoManager
            sessionId={id}
            team={
              ((session.schema_data as Record<string, unknown> | null)?.team as
                Array<{ name: string; title?: string; credentials?: string[] }>) ?? []
            }
            assets={assets ?? []}
            signedUrls={signedUrls}
          />
          <StockPhotoManager sessionId={id} assets={assets ?? []} signedUrls={signedUrls} />
          <AssetsViewer assets={assets ?? []} signedUrls={signedUrls} />
        </div>
        {session.pdf_url && (
          <div className="mt-4 flex flex-col gap-2">
            <a
              href={`/api/pdf/download?path=${encodeURIComponent(session.pdf_url)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
            >
              Download MBP (PDF)
            </a>
            <a
              href={`/api/pdf/download?path=${encodeURIComponent(`pdfs/${id}/mbp.md`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
            >
              Download MBP (Markdown)
            </a>
            <RegenerateMbpButton sessionId={id} />
          </div>
        )}
        {/* Deliverable generation failed during approval — let the admin retry
            rather than leaving the approved session with no MBP artifact. */}
        {!session.pdf_url && session.status === 'approved' && (
          <div className="mt-4">
            <p className="text-error text-sm font-body mb-1">
              The MBP deliverable wasn&apos;t generated. Generate it now:
            </p>
            <RegenerateMbpButton sessionId={id} label="Generate MBP" />
          </div>
        )}
        {session.status === 'approved' && (
          <div className="mt-4">
            <Link
              href={`/admin/content/${id}`}
              className="inline-flex items-center gap-2 bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark"
            >
              Begin Content Generation &rarr;
            </Link>
          </div>
        )}
        {session.status === 'completed' && isAdmin && (
          <ApproveButton sessionId={id} />
        )}
        {['pending', 'in_progress'].includes(session.status) && (
          <div className="mt-4">
            <SendReminderButton sessionId={id} />
          </div>
        )}
        {['pending', 'in_progress'].includes(session.status) && isAdmin && (
          <MarkCompleteButton sessionId={id} />
        )}
        <DeleteSessionButton sessionId={id} />
      </div>
    </div>
  )
}
