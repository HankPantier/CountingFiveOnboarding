// Pure aggregation over token_usage rows for the admin Token Usage dashboard.
// Kept dependency-free (besides the shared cost estimator) and side-effect-free
// so it can be unit-tested and run inside a Server Component. Cost is recomputed
// from estimateCostUsd rather than trusting the stored cost_usd, matching the
// existing dashboard summary (app/admin/dashboard/page.tsx).
import { estimateCostUsd, type TokenTask } from '@/lib/content/token-pricing'

export const TASKS: readonly TokenTask[] = ['onboarding', 'audit', 'content']

// Minimal row shape this module needs — a subset of the token_usage columns.
export type UsageRow = {
  task: string
  stage: string
  model: string
  input_tokens: number
  output_tokens: number
  session_id: string | null
  audit_id: string | null
  created_at: string
}

export type Totals = {
  cost: number
  inputTokens: number
  outputTokens: number
  calls: number
}

export type ClientUsage = {
  clientId: string | null // session id, or null for the Unassigned bucket
  label: string
  total: Totals
  byTask: Record<TokenTask, Totals>
  byModel: Record<string, Totals>
}

export type UsageSummary = {
  allTime: Totals
  last30: Totals
  thisMonth: Totals
  byModel: Record<string, Totals>
}

const UNASSIGNED_LABEL = 'Unassigned / System'

export function emptyTotals(): Totals {
  return { cost: 0, inputTokens: 0, outputTokens: 0, calls: 0 }
}

export function rowCost(row: UsageRow): number {
  return estimateCostUsd(row.model, row.input_tokens, row.output_tokens)
}

function addInto(t: Totals, row: UsageRow): void {
  t.cost += rowCost(row)
  t.inputTokens += row.input_tokens
  t.outputTokens += row.output_tokens
  t.calls += 1
}

function asTask(value: string): TokenTask {
  return (TASKS as readonly string[]).includes(value) ? (value as TokenTask) : 'content'
}

/** Top-line totals: all-time, trailing 30 days, and current calendar month. */
export function summarize(rows: UsageRow[], nowMs: number): UsageSummary {
  const now = new Date(nowMs)
  const thirtyDaysAgo = nowMs - 30 * 24 * 60 * 60 * 1000
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)

  const summary: UsageSummary = {
    allTime: emptyTotals(),
    last30: emptyTotals(),
    thisMonth: emptyTotals(),
    byModel: {},
  }

  for (const row of rows) {
    const ts = new Date(row.created_at).getTime()
    addInto(summary.allTime, row)
    if (ts >= thirtyDaysAgo) addInto(summary.last30, row)
    if (ts >= monthStart) addInto(summary.thisMonth, row)
    summary.byModel[row.model] ??= emptyTotals()
    addInto(summary.byModel[row.model], row)
  }
  return summary
}

/** Per-client rollup. Rows with a session_id roll up to that client; everything
 * else (standalone audits, system one-offs) collapses into one Unassigned row.
 * `labels` maps session_id → display label (website_url). Sorted by cost desc. */
export function byClient(rows: UsageRow[], labels: Record<string, string>): ClientUsage[] {
  const map = new Map<string, ClientUsage>()

  for (const row of rows) {
    const clientId = row.session_id ?? null
    const key = clientId ?? '__unassigned__'
    let entry = map.get(key)
    if (!entry) {
      entry = {
        clientId,
        label: clientId ? labels[clientId] ?? clientId : UNASSIGNED_LABEL,
        total: emptyTotals(),
        byTask: { onboarding: emptyTotals(), audit: emptyTotals(), content: emptyTotals() },
        byModel: {},
      }
      map.set(key, entry)
    }
    addInto(entry.total, row)
    addInto(entry.byTask[asTask(row.task)], row)
    entry.byModel[row.model] ??= emptyTotals()
    addInto(entry.byModel[row.model], row)
  }

  return [...map.values()].sort((a, b) => b.total.cost - a.total.cost)
}

export type DailyPoint = { date: string; cost: number; tokens: number }

/** Daily spend/token series (UTC date buckets), ascending by date. Optionally
 * filtered to a single task. Returns one point per day that has usage. */
export function dailySeries(rows: UsageRow[], task?: TokenTask): DailyPoint[] {
  const buckets = new Map<string, DailyPoint>()
  for (const row of rows) {
    if (task && asTask(row.task) !== task) continue
    const date = row.created_at.slice(0, 10)
    let point = buckets.get(date)
    if (!point) {
      point = { date, cost: 0, tokens: 0 }
      buckets.set(date, point)
    }
    point.cost += rowCost(row)
    point.tokens += row.input_tokens + row.output_tokens
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date))
}
