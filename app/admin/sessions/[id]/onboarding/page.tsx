import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds } from '@/lib/auth/access'
import { buildMbpDocument } from '@/lib/mbp/build-document'
import OnboardingNotes from '@/components/admin/onboarding/OnboardingNotes'
import MbpDocument from '@/components/admin/mbp/MbpDocument'
import MbpCompleteness from '@/components/admin/mbp/MbpCompleteness'
import ChatInterface from '@/components/chat/ChatInterface'
import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'

// Rep-driven onboarding: a live-call workflow the Revaltus rep runs.
//   1. Notes  — capture freeform call notes (autosaved)
//   2. Review — the agent extracts notes into the profile; rep reviews/corrects
//   3. Chat   — staff-mode Q&A fills the remaining gaps
// Stage is derived from the session's notes_extracted_at plus an optional
// ?step override so the rep can jump back to notes or forward to the chat.
export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ step?: string }>
}) {
  const { id } = await params
  const { step } = await searchParams

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
    .select('id, website_url, schema_data, gap_list, call_notes, notes_extracted_at, current_phase, status')
    .eq('id', id)
    .single()
  if (!session) notFound()

  const extracted = !!session.notes_extracted_at
  const stage: 'notes' | 'review' | 'chat' =
    step === 'chat' ? 'chat' : step === 'notes' ? 'notes' : extracted ? 'review' : 'notes'

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-heading font-bold text-brand-navy">Onboarding call</h1>
        <p className="text-text-secondary font-body text-sm mt-1">{session.website_url}</p>
      </div>
      <Link
        href={`/admin/sessions/${id}`}
        className="border border-border-default text-text-secondary font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy"
      >
        ← Session
      </Link>
    </div>
  )

  const steps = (
    <nav className="flex items-center gap-2 text-xs font-heading font-semibold" aria-label="Onboarding steps">
      <StepPill href={`/admin/sessions/${id}/onboarding?step=notes`} active={stage === 'notes'} n={1} label="Notes" />
      <span className="text-text-muted">→</span>
      <StepPill href={`/admin/sessions/${id}/onboarding`} active={stage === 'review'} n={2} label="Review" disabled={!extracted} />
      <span className="text-text-muted">→</span>
      <StepPill href={`/admin/sessions/${id}/onboarding?step=chat`} active={stage === 'chat'} n={3} label="Q&A chat" disabled={!extracted} />
    </nav>
  )

  if (stage === 'chat') {
    const { data: dbMessages } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', id)
      .order('created_at', { ascending: true })

    // Full session row for the chat component (mirrors the retired public page).
    const { data: fullSession } = await supabase.from('sessions').select('*').eq('id', id).single()
    if (!fullSession) notFound()

    return (
      <main className="p-8 space-y-4">
        {header}
        {steps}
        <p className="text-text-secondary font-body text-sm">
          Work through the remaining questions with the client on the call — the agent addresses you, not the client.
          Corrections you make in Review are already saved; the chat only asks about what&apos;s still missing.
        </p>
        <div className="border border-border-default rounded-xl overflow-hidden h-[calc(100vh-16rem)]">
          <ChatInterface
            sessionId={id}
            initialSession={fullSession}
            initialMessages={dbMessages ?? []}
            initialIsStaffMode
          />
        </div>
      </main>
    )
  }

  if (stage === 'notes') {
    return (
      <main className="p-8 space-y-6">
        {header}
        {steps}
        <p className="text-text-secondary font-body text-sm max-w-2xl">
          Capture notes from the onboarding call. When you&apos;re done, analyze them — the agent pulls
          contact, services, brand, and more into the profile (filling only blank fields), then you review
          before the Q&A.
        </p>
        <OnboardingNotes sessionId={id} initialNotes={session.call_notes ?? ''} alreadyExtracted={extracted} />
      </main>
    )
  }

  // Review stage
  const schema = (session.schema_data ?? {}) as SessionSchema
  const gaps = (session.gap_list as GapItem[]) ?? []
  const doc = buildMbpDocument(schema, null)
  const overrides = (schema._meta?.admin_overrides as Record<string, boolean> | undefined) ?? {}

  return (
    <main className="p-8 space-y-6">
      {header}
      {steps}
      <div className="rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 px-4 py-3">
        <p className="text-sm font-body text-text-primary">
          <span className="font-heading font-semibold">Notes analyzed.</span> Review what the agent captured
          below and correct anything that&apos;s off{isAdmin ? '' : ' (ask an admin to fix a field, or handle it in the chat)'}.
          The Q&A will only ask about the remaining gaps.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Link
            href={`/admin/sessions/${id}/onboarding?step=chat`}
            className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-5 py-2 rounded-pill shadow-cyan-base transition-all hover:-translate-y-px hover:bg-brand-cyan-dark hover:shadow-cyan-glow"
          >
            Start the Q&A chat →
          </Link>
          <Link
            href={`/admin/sessions/${id}/onboarding?step=notes`}
            className="text-text-secondary hover:text-brand-navy font-heading font-semibold text-xs"
          >
            ← Edit notes / re-analyze
          </Link>
        </div>
      </div>

      <MbpCompleteness doc={doc} gaps={gaps} />
      <MbpDocument doc={doc} overrides={overrides} sessionId={id} editable={isAdmin} />
    </main>
  )
}

function StepPill({
  href, active, n, label, disabled,
}: { href: string; active: boolean; n: number; label: string; disabled?: boolean }) {
  const cls = active
    ? 'bg-brand-navy text-text-inverse'
    : 'text-text-secondary hover:bg-surface-subtle'
  if (disabled) {
    return (
      <span className="px-3 py-1.5 rounded-pill text-text-muted/50 cursor-not-allowed">
        {n}. {label}
      </span>
    )
  }
  return (
    <Link href={href} className={`px-3 py-1.5 rounded-pill transition-colors ${cls}`}>
      {n}. {label}
    </Link>
  )
}
