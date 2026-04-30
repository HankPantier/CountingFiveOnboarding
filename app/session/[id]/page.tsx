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
