import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import {
  summarize,
  byClient,
  dailySeries,
  TASKS,
  type UsageRow,
  type Totals,
  type AuditMeta,
} from '@/lib/tokens/aggregate'
import type { TokenTask } from '@/lib/content/token-pricing'
import TokenTrendChart from '@/components/admin/TokenTrendChart'
import ClientUsageTable from '@/components/admin/ClientUsageTable'
import SpendBreakdownCharts, { type SpendSlice } from '@/components/admin/SpendBreakdownCharts'

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
export default async function TokenUsagePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (user.role !== 'admin') redirect('/admin/dashboard')

  const supabase = createServerClient()

  // High range overrides PostgREST's implicit 1000-row cap. At current volume
  // this is fine; a DB-side aggregate view is the scale path if it grows.
  const [{ data: usage }, { data: sessions }, { data: auditRuns }] = await Promise.all([
    supabase
      .from('token_usage')
      .select('task, stage, model, input_tokens, output_tokens, session_id, audit_id, created_at')
      .order('created_at', { ascending: false })
      .range(0, 49999),
    supabase.from('sessions').select('id, website_url'),
    supabase.from('audit_runs').select('id, session_id, site_name, domain'),
  ])

  const rows: UsageRow[] = usage ?? []
  const labels: Record<string, string> = {}
  for (const s of sessions ?? []) labels[s.id] = s.website_url ?? s.id

  // Audit token rows often carry only audit_id; resolve their client through
  // audit_runs (the session link is added by the audit→onboarding bridge after
  // the tokens are recorded).
  const audits: Record<string, AuditMeta> = {}
  for (const a of auditRuns ?? []) {
    audits[a.id] = { sessionId: a.session_id, siteName: a.site_name, domain: a.domain }
  }

  // Server Component renders once per request, so Date.now() is deterministic
  // for the render — the React-Compiler purity rule doesn't apply.
  // eslint-disable-next-line react-hooks/purity
  const summary = summarize(rows, Date.now())
  const clients = byClient(rows, labels, audits)
  const series = {
    all: dailySeries(rows),
    onboarding: dailySeries(rows, 'onboarding'),
    audit: dailySeries(rows, 'audit'),
    content: dailySeries(rows, 'content'),
  }

  const models = Object.entries(summary.byModel).sort((a, b) => b[1].cost - a[1].cost)

  const categorySpend: SpendSlice[] = TASKS.map((task) => ({
    name: TASK_LABEL[task],
    cost: summary.byTask[task].cost,
  }))
  const modelSpend: SpendSlice[] = models.map(([model, t]) => ({ name: model, cost: t.cost }))
  // Top 8 clients by spend; the long tail folds into a single "Other" bar.
  const TOP = 8
  const clientSpend: SpendSlice[] = clients.slice(0, TOP).map((c) => ({ name: c.label, cost: c.total.cost }))
  const otherCost = clients.slice(TOP).reduce((sum, c) => sum + c.total.cost, 0)
  if (otherCost > 0) clientSpend.push({ name: 'Other', cost: otherCost })

  return (
    <div className="px-6 py-8 max-w-[1200px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-heading font-bold text-brand-navy">Token Usage</h1>
        <p className="text-sm font-body text-text-secondary mt-1">
          AI spend across onboarding, audits, and content. Costs are estimated from per-model rates.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <StatTile label="This month" totals={summary.thisMonth} />
        <StatTile label="Last 30 days" totals={summary.last30} />
        <StatTile label="All time" totals={summary.allTime} />
      </div>

      <SpendBreakdownCharts categories={categorySpend} models={modelSpend} clients={clientSpend} />

      <div className="mb-6">
        <TokenTrendChart series={series} />
      </div>

      <section>
        <h2 className="text-lg font-heading font-bold text-brand-navy mb-3">Usage by client</h2>
        <ClientUsageTable clients={clients} />
      </section>
    </div>
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

function StatTile({ label, totals }: { label: string; totals: Totals }) {
  return (
    <div className="bg-surface-card border border-border-default rounded-xl shadow-subtle p-5">
      <p className="text-xs font-heading font-semibold text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-heading font-bold text-brand-navy mt-1 tabular-nums">{money(totals.cost)}</p>
      <p className="text-sm font-body text-text-secondary mt-1 tabular-nums">
        {fmtTokens(totals.inputTokens + totals.outputTokens)} tokens · {totals.calls} calls
      </p>
    </div>
  )
}
