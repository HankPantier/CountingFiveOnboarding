import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/access'
import { TASKS, topByCost } from '@/lib/tokens/aggregate'
import type { TokenTask } from '@/lib/content/token-pricing'
import TokenTrendChart from '@/components/admin/TokenTrendChart'
import ClientUsageTable from '@/components/admin/ClientUsageTable'
import SpendBreakdownCharts, { type SpendSlice } from '@/components/admin/SpendBreakdownCharts'
import { loadTokenUsage } from './_data'
import type { DateRangeParams } from '@/lib/tokens/date-range'

// Billing view: always render fresh so newly recorded usage shows immediately
// (never serve a cached full-route snapshot).
export const dynamic = 'force-dynamic'

const TASK_LABEL: Record<TokenTask, string> = {
  onboarding: 'Onboarding',
  audit: 'Audit',
  content: 'Content',
}

// Token usage is a global operator/billing view — admins only (mirrors the
// admin-only spend metric on the dashboard and the audits subtree).
export default async function TokenUsagePage({
  searchParams,
}: {
  searchParams: Promise<DateRangeParams>
}) {
  // Admin-only enforcement (else 403) lives in the section layout.
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')

  const { range, summary, clients, users, series, userSeries } = await loadTokenUsage(await searchParams)

  const models = Object.entries(summary.byModel).sort((a, b) => b[1].cost - a[1].cost)

  const categorySpend: SpendSlice[] = TASKS.map((task) => ({
    name: TASK_LABEL[task],
    cost: summary.byTask[task].cost,
  }))
  const modelSpend: SpendSlice[] = models.map(([model, t]) => ({ name: model, cost: t.cost }))
  const clientSpend = topByCost(clients.map((c) => ({ name: c.label, cost: c.total.cost })), 8)
  const userSpend = topByCost(users.map((u) => ({ name: u.label, cost: u.total.cost })), 8)

  // Post-filter, summary.allTime is the total for the selected range.
  const total = summary.allTime

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <StatTile label={`Spend · ${range.label}`} value={money(total.cost)} sub={`${total.calls} calls`} />
        <StatTile
          label="Tokens"
          value={fmtTokens(total.inputTokens + total.outputTokens)}
          sub={`${fmtTokens(total.inputTokens)} in · ${fmtTokens(total.outputTokens)} out`}
        />
        <StatTile label="Calls" value={String(total.calls)} sub={range.label} />
      </div>

      <SpendBreakdownCharts categories={categorySpend} models={modelSpend} clients={clientSpend} users={userSpend} />

      <div className="mb-6">
        <TokenTrendChart series={series} userSeries={userSeries} />
      </div>

      <section>
        <h2 className="text-lg font-heading font-bold text-brand-navy mb-3">Usage by client</h2>
        <ClientUsageTable clients={clients} />
      </section>
    </>
  )
}

function money(v: number): string {
  return `$${v.toFixed(2)}`
}

function fmtTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return String(v)
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-surface-card border border-border-default rounded-xl shadow-subtle p-5">
      <p className="text-xs font-heading font-semibold text-text-muted uppercase tracking-wide truncate">{label}</p>
      <p className="text-2xl font-heading font-bold text-brand-navy mt-1 tabular-nums">{value}</p>
      <p className="text-sm font-body text-text-secondary mt-1 tabular-nums">{sub}</p>
    </div>
  )
}
