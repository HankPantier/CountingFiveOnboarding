import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/access'
import { topByCost } from '@/lib/tokens/aggregate'
import type { SpendSlice } from '@/components/admin/SpendBreakdownCharts'
import SpendBarCard from '@/components/admin/SpendBarCard'
import UserClientMatrix from '@/components/admin/UserClientMatrix'
import { loadTokenUsage } from '../_data'

export const dynamic = 'force-dynamic'

// Per-user × per-client AI spend. Admin-only enforcement lives in the layout.
export default async function ByUserClientPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const { userClients } = await loadTokenUsage()

  // Top user→client pairs by spend across the whole matrix.
  const pairs: SpendSlice[] = topByCost(
    userClients.flatMap((u) =>
      u.clients.map((c) => ({ name: `${u.label} → ${c.clientLabel}`, cost: c.total.cost }))
    ),
    12
  )

  return (
    <>
      <SpendBarCard heading="Top user → client pairs by spend" data={pairs} />

      <section>
        <h2 className="text-lg font-heading font-bold text-brand-navy mb-3">Usage by user &amp; client</h2>
        <p className="text-sm font-body text-text-secondary mb-3">
          How much each person spent on each client. Expand a user to see their per-client breakdown.
        </p>
        <UserClientMatrix users={userClients} />
      </section>
    </>
  )
}
