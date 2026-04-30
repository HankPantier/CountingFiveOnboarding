import { createServerClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import ChatInterface from '@/components/chat/ChatInterface'

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createServerClient()

  const { data: session, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !session) notFound()

  // A stuck processing flag means the previous stream was abandoned (dev restart, network drop, etc).
  // Safe to clear on page load — the client opening this page proves no stream is active.
  if (session.processing) {
    await supabase.from('sessions').update({ processing: false }).eq('id', id)
    session.processing = false
  }

  // Phase 0 is a server-side creation state — auto-advance to phase 1 on first client visit.
  // Also wipe any messages saved while the session was at phase 0 (Claude should never
  // have responded during phase 0; any messages there are contaminated and must be cleared
  // so __init__ fires fresh with phase 1 instructions).
  if (session.current_phase === 0) {
    await Promise.all([
      supabase.from('sessions').update({ current_phase: 1 }).eq('id', id),
      supabase.from('messages').delete().eq('session_id', id),
    ])
    session.current_phase = 1
  }

  if (session.status === 'approved') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-page">
        <div className="text-center px-8">
          <h1 className="text-2xl font-heading font-bold text-brand-navy">
            You&apos;re all set!
          </h1>
          <p className="text-text-secondary font-body mt-2">
            Your onboarding is complete. Our team will be in touch soon.
          </p>
        </div>
      </div>
    )
  }

  const { data: dbMessages } = await supabase
    .from('messages')
    .select('role, content')
    .eq('session_id', id)
    .order('created_at', { ascending: true })

  return (
    <ChatInterface
      sessionId={id}
      initialSession={session}
      initialMessages={dbMessages ?? []}
    />
  )
}
