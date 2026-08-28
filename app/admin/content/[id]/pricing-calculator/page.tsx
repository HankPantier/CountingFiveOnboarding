import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAccessibleSessionIds, isSiteOwner } from '@/lib/auth/access'
import { loadPricingCalculatorForSession } from '@/lib/content/pricing-calculator-repo-sync'
import PricingCalculatorEditor from '@/components/content/PricingCalculatorEditor'
import type { SessionSchema } from '@/types/session-schema'

export default async function PricingCalculatorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // Managers may only open clients assigned to them. Site Owners are locked out
  // of config surfaces (CLAUDE.md rule 6) — pricing config is staff-only.
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (isSiteOwner(user)) notFound()
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

  const record = await loadPricingCalculatorForSession(id)
  const firmName = (session.schema_data as SessionSchema | null)?.business?.name

  return (
    <main className="p-8 max-w-[1000px] mx-auto">
      <div className="mb-8">
        <Link
          href={record.published ? `/admin/content/${id}/edit` : `/admin/content/${id}`}
          className="text-sm font-body text-text-muted hover:text-brand-cyan transition-colors"
        >
          &larr; Back to {record.published ? 'content editor' : 'content workflow'}
        </Link>
        <div className="mt-4">
          <h1 className="text-2xl font-heading font-bold text-brand-navy">Pricing calculator</h1>
          <p className="text-text-secondary font-body text-sm mt-1">
            {firmName ?? session.website_url} · configure the interactive estimate shown on the client site
          </p>
        </div>
      </div>

      <PricingCalculatorEditor
        sessionId={id}
        initialConfig={record.config}
        initialEnabled={record.enabled}
        published={record.published}
      />
    </main>
  )
}
