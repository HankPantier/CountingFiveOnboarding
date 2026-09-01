// One-shot heuristic backfill of historical token_usage.created_by.
// For each row with created_by NULL and a session_id, attribute it to:
//   1. the session's assigned manager, if exactly one exists (manager_clients), else
//   2. the creator of the session's audit, if exactly one exists (audit_runs.created_by).
// Rows with no session_id, or whose session has neither signal, stay NULL.
// Every UPDATE is guarded with `.is('created_by', null)` so it never overwrites
// attribution set by live code, and a backup of every changed id is written for undo.
//
// Dry-run by default:   npx tsx scripts/backfill-attribution.ts
// Apply for real:       npx tsx scripts/backfill-attribution.ts --commit
import { config } from 'dotenv'
config({ path: '.env.local' })
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const COMMIT = process.argv.includes('--commit')
const BACKUP_PATH = '/tmp/token-attribution-backfill-backup.json'

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 1a. session → single assigned manager (authoritative).
  const { data: mc } = await supabase.from('manager_clients').select('manager_id, session_id')
  const mgrSets = new Map<string, Set<string>>()
  for (const r of mc ?? []) {
    if (!mgrSets.has(r.session_id)) mgrSets.set(r.session_id, new Set())
    mgrSets.get(r.session_id)!.add(r.manager_id)
  }
  const singleManager = new Map<string, string>()
  for (const [sess, set] of mgrSets) if (set.size === 1) singleManager.set(sess, [...set][0])

  // 1b. session → single audit creator (fallback).
  const { data: audits } = await supabase
    .from('audit_runs')
    .select('session_id, created_by')
    .not('session_id', 'is', null)
    .not('created_by', 'is', null)
  const auditSets = new Map<string, Set<string>>()
  for (const a of audits ?? []) {
    if (!auditSets.has(a.session_id!)) auditSets.set(a.session_id!, new Set())
    auditSets.get(a.session_id!)!.add(a.created_by!)
  }
  const singleAuditCreator = new Map<string, string>()
  for (const [sess, set] of auditSets) if (set.size === 1) singleAuditCreator.set(sess, [...set][0])

  const resolve = (sessionId: string | null): string | null =>
    sessionId ? singleManager.get(sessionId) ?? singleAuditCreator.get(sessionId) ?? null : null

  // 2. Fetch ALL null rows (paged to beat the 1000-row PostgREST cap).
  let nullRows: { id: string; session_id: string | null }[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('token_usage')
      .select('id, session_id')
      .is('created_by', null)
      .range(from, from + 999)
    if (!data || data.length === 0) break
    nullRows = nullRows.concat(data)
    if (data.length < 1000) break
  }

  // 3. Group resolvable row ids by target user.
  const byTarget = new Map<string, string[]>()
  let unresolved = 0
  for (const r of nullRows) {
    const target = resolve(r.session_id)
    if (!target) { unresolved++; continue }
    if (!byTarget.has(target)) byTarget.set(target, [])
    byTarget.get(target)!.push(r.id)
  }

  const totalToUpdate = [...byTarget.values()].reduce((s, ids) => s + ids.length, 0)
  console.log(`null rows: ${nullRows.length}`)
  console.log(`  resolvable → ${totalToUpdate} across ${byTarget.size} users`)
  console.log(`  staying unattributed: ${unresolved}`)
  for (const [target, ids] of byTarget) console.log(`    ${target}: ${ids.length}`)

  if (!COMMIT) {
    console.log('\nDRY RUN — no writes. Re-run with --commit to apply.')
    return
  }

  // 4. Backup every id we are about to change (all were NULL → undo = set NULL).
  const backup = { at: new Date().toISOString(), updates: [...byTarget.entries()].map(([target, ids]) => ({ target, ids })) }
  writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2))
  console.log(`\nBackup written: ${BACKUP_PATH}`)

  // 5. Apply, batched, guarded so we never overwrite live-set attribution.
  let updated = 0
  for (const [target, ids] of byTarget) {
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500)
      const { data, error } = await supabase
        .from('token_usage')
        .update({ created_by: target })
        .in('id', batch)
        .is('created_by', null)
        .select('id')
      if (error) { console.error('update failed:', error.message); process.exit(1) }
      updated += data?.length ?? 0
    }
  }
  console.log(`updated: ${updated} rows`)

  // 6. Verify.
  const { count } = await supabase.from('token_usage').select('*', { count: 'exact', head: true }).is('created_by', null)
  console.log(`remaining unattributed: ${count}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
