// Read-only diagnostic: which token_usage rows lack created_by, grouped by
// task+stage, split into historical (pre-tracking) vs recent (after the feature
// shipped ~2026-09-01). Recent unattributed rows point at a stamping gap.
// Run: npx tsx scripts/diagnose-token-attribution.ts
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const SHIP = '2026-09-01T00:00:00Z' // feature deploy boundary (approx)

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('token_usage')
    .select('task, stage, created_by, content_job_id, audit_id, session_id, created_at, cost_usd')
    .range(0, 199999)
  if (error) throw error
  const rows = data ?? []

  type Agg = { rows: number; cost: number; null_created: number; recent_null: number; recent_rows: number }
  const byStage = new Map<string, Agg>()
  let totalNull = 0
  let totalRecentNull = 0
  let recentNullNoJobNoAudit = 0

  for (const r of rows) {
    const key = `${r.task} / ${r.stage}`
    const a = byStage.get(key) ?? { rows: 0, cost: 0, null_created: 0, recent_null: 0, recent_rows: 0 }
    a.rows += 1
    a.cost += Number(r.cost_usd ?? 0)
    const isRecent = r.created_at >= SHIP
    if (isRecent) a.recent_rows += 1
    if (!r.created_by) {
      a.null_created += 1
      totalNull += 1
      if (isRecent) {
        a.recent_null += 1
        totalRecentNull += 1
        if (!r.content_job_id && !r.audit_id) recentNullNoJobNoAudit += 1
      }
    }
    byStage.set(key, a)
  }

  console.log(`\nTotal rows: ${rows.length}`)
  console.log(`Unattributed (created_by null): ${totalNull} (${((totalNull / rows.length) * 100).toFixed(1)}%)`)
  console.log(`Unattributed created AFTER ${SHIP}: ${totalRecentNull}`)
  console.log(`  ...of those, rows with NO content_job_id and NO audit_id (unresolvable): ${recentNullNoJobNoAudit}\n`)

  console.log('Per task/stage — recentNull / recentRows  (totalNull / totalRows)  $cost:')
  const sorted = [...byStage.entries()].sort((a, b) => b[1].recent_null - a[1].recent_null || b[1].null_created - a[1].null_created)
  for (const [k, a] of sorted) {
    console.log(
      `  ${k.padEnd(34)} recent ${String(a.recent_null).padStart(4)}/${String(a.recent_rows).padStart(4)}   all ${String(a.null_created).padStart(5)}/${String(a.rows).padStart(5)}   $${a.cost.toFixed(2)}`
    )
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
