import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/access'
import { topByCost } from '@/lib/tokens/aggregate'
import type { SpendSlice } from '@/components/admin/SpendBreakdownCharts'
import UserSpendCharts from '@/components/admin/UserSpendCharts'
import UserUsageTable from '@/components/admin/UserUsageTable'
import TokenTrendChart from '@/components/admin/TokenTrendChart'
import { loadTokenUsage } from '../_data'
import type { DateRangeParams } from '@/lib/tokens/date-range'

export const dynamic = 'force-dynamic'

// Per-user AI spend. Admin-only enforcement lives in the section layout.
export default async function ByUserPage({
  searchParams,
}: {
  searchParams: Promise<DateRangeParams>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const { users, series, userSeries } = await loadTokenUsage(await searchParams)

  const userSpend: SpendSlice[] = topByCost(users.map((u) => ({ name: u.label, cost: u.total.cost })), 8)

  return (
    <>
      <UserSpendCharts users={userSpend} />

      <div className="mb-6">
        <TokenTrendChart series={series} userSeries={userSeries} />
      </div>

      <section>
        <h2 className="text-lg font-heading font-bold text-brand-navy mb-3">Usage by user</h2>
        <UserUsageTable users={users} />
      </section>
    </>
  )
}
