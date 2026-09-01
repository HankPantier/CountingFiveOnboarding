import { requirePageAccess } from '@/lib/auth/page-guards'
import TokenUsageTabs from '@/components/admin/TokenUsageTabs'
import TokenUsageRangeFilter from '@/components/admin/TokenUsageRangeFilter'

// Token usage (AI spend) is admin-only; everyone else gets 403. The sidebar
// shell lives in app/admin/layout.tsx. The shared header + sub-nav live here so
// they render across the overview / by-user / by-user-client pages.
export default async function TokenUsageLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requirePageAccess('admin')
  return (
    <div className="px-6 py-8 max-w-[1200px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-heading font-bold text-brand-navy">Token Usage</h1>
        <p className="text-sm font-body text-text-secondary mt-1">
          AI spend across onboarding, audits, and content. Costs are estimated from per-model rates.
        </p>
      </header>
      <TokenUsageTabs />
      <TokenUsageRangeFilter />
      {children}
    </div>
  )
}
