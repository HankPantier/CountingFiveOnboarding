import { createServerClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

// The client-facing self-serve onboarding chat is retired: onboarding now runs
// as a live call a Revaltus rep drives (see /admin/sessions/[id]/onboarding).
// This route is kept only so existing links resolve to a friendly notice rather
// than a 404 — it renders no chat and requires no auth.
export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createServerClient()

  const { data: session, error } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', id)
    .single()

  if (error || !session) notFound()

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-page">
      <div className="text-center px-8 max-w-md">
        <h1 className="text-2xl font-heading font-bold text-brand-navy">
          Your Revaltus onboarding
        </h1>
        <p className="text-text-secondary font-body mt-2">
          Onboarding is now handled directly with your Revaltus representative on a call — there&apos;s
          nothing to fill out here. If you have questions, just reach out to your rep and they&apos;ll take
          care of it.
        </p>
      </div>
    </div>
  )
}
