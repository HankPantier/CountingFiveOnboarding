// One-shot data fix: re-home orphaned top-level schema_data keys.
//
// Before the schema-write.ts bracket-parsing fix, approving an AI MBP suggestion
// whose fieldPath used bracket/dot notation (e.g. "niches[3].description",
// "business.positioningStatement") wrote a LITERAL top-level key named after the
// whole path instead of updating the nested location. The admin MBP accordions
// (lib/mbp/build-document.ts) only read properly-nested keys, so those approved
// changes became invisible. This script finds those orphaned keys and re-homes
// each value into its correct nested location via the now-fixed deepSetPath.
//
// Conflict policy (confirmed: report-only, do not clobber good data):
//   - Nested target already equals the orphan value → drop.   ALREADY PRESENT
//   - Nested target is empty/absent → safe to fill.           RE-HOMED (target empty)
//   - BRACKET-path orphan (targets an array element, e.g.
//     niches[3].description) over a non-empty target → the
//     orphan came from a broken suggestion APPROVAL and the
//     nested value is the pre-approval original, so the
//     approved value wins.                                     RE-HOMED (approved over existing)
//   - DOT-path orphan (e.g. business.positioningStatement)
//     over a DIFFERENT non-empty target → this came from the
//     older onboarding deepMerge leak; the nested value is
//     newer/authoritative, so do NOT clobber it.               CONFLICT (reported)
// Why the split: bracket paths ONLY ever orphaned via suggestion approval (dot
// paths always nested correctly under the old code), so a bracket orphan is a
// lost approved change worth restoring, while a dot orphan is stale onboarding
// data that must never overwrite a hand-verified value (e.g. it would otherwise
// reintroduce a banned "nearly 40 years" positioning statement).
// _meta.phase3_completed_chunks is UNIONED, never dropped (phase gate safety).
//
// Also (per request) ensures "emojis" is in brand.toneToAvoid for one session.
//
// Usage:
//   npx tsx scripts/repair-orphaned-schema-paths.ts                    # dry run, all sessions
//   npx tsx scripts/repair-orphaned-schema-paths.ts --apply            # write, all sessions
//   npx tsx scripts/repair-orphaned-schema-paths.ts --session=<uuid>   # dry run, one session
//   npx tsx scripts/repair-orphaned-schema-paths.ts --apply --session=<uuid>

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { deepSetPath, getByPath } from '../lib/mbp/schema-write'

// Minimal .env.local loader — avoids adding a dotenv dependency.
const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const apply = process.argv.includes('--apply')
const onlySession = process.argv.find(a => a.startsWith('--session='))?.split('=')[1]
const supabase = createClient(url, serviceKey)

// Session that should also gain a "no emojis" tone-to-avoid rule (never filed).
const EMOJI_SESSION_ID = '94247ec6-c50f-4806-85e0-b2f425bbf52d'

type Obj = Record<string, unknown>
const isPlainObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// Normalize bracket indices to dot form for path comparison / getByPath reads.
const normPath = (p: string): string =>
  p.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).join('.')

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  if (isPlainObj(v)) return Object.keys(v).length === 0
  return false
}

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// Flatten an orphan {key: value} into leaf (path, value) pairs. Recurse only
// into plain objects so `niches[3] → {description, subCategories}` yields
// `niches[3].description` and `niches[3].subCategories` (the array set whole),
// while a scalar/array orphan value is a single leaf at its own key.
function leaves(basePath: string, value: unknown, out: Array<[string, unknown]>) {
  if (isPlainObj(value)) {
    for (const [k, v] of Object.entries(value)) leaves(`${basePath}.${k}`, v, out)
  } else {
    out.push([basePath, value])
  }
}

function repairSchema(schema: Obj, log: string[]): boolean {
  let draft = schema
  let changed = false

  const orphanKeys = Object.keys(draft).filter(k => /[.[]/.test(k))
  for (const orphanKey of orphanKeys) {
    const pairs: Array<[string, unknown]> = []
    leaves(orphanKey, draft[orphanKey], pairs)

    let allResolved = true
    for (const [leafPath, leafValue] of pairs) {
      const np = normPath(leafPath)
      // A bracket index means the orphan targets an array element — those only
      // ever orphaned via a broken suggestion approval, so the orphan value is
      // the admin's approved change.
      const targetsArrayElement = /\[\d+\]/.test(leafPath)

      // Phase-3 gate markers: UNION, never drop or clobber.
      if (np === '_meta.phase3_completed_chunks') {
        const existing = getByPath(draft, np)
        const prev = Array.isArray(existing) ? (existing as unknown[]) : []
        const next = Array.isArray(leafValue) ? (leafValue as unknown[]) : []
        const unioned = Array.from(new Set([...prev, ...next]))
        if (!eq(unioned, existing)) {
          draft = deepSetPath(draft, np, unioned)
          changed = true
        }
        log.push(`  RE-HOMED (union) ${leafPath} → ${np}`)
        continue
      }

      const target = getByPath(draft, np)

      if (!isEmpty(target) && eq(target, leafValue)) {
        log.push(`  ALREADY PRESENT ${leafPath} (== ${np})`)
        continue
      }
      if (isEmpty(target)) {
        draft = deepSetPath(draft, np, leafValue)
        changed = true
        log.push(`  RE-HOMED (target empty) ${leafPath} → ${np}`)
        continue
      }
      // Target is non-empty and differs.
      if (targetsArrayElement) {
        draft = deepSetPath(draft, np, leafValue)
        changed = true
        log.push(`  RE-HOMED (approved over existing) ${leafPath} → ${np}`)
        continue
      }
      // Dot-path orphan over a different non-empty value: stale onboarding-era
      // data — never clobber the newer nested value. Leave orphan for review.
      allResolved = false
      log.push(
        `  CONFLICT ${leafPath}: orphan=${JSON.stringify(leafValue).slice(0, 80)} ` +
          `vs existing ${np}=${JSON.stringify(target).slice(0, 80)} — left in place, kept nested`
      )
    }

    if (allResolved) {
      // Rebuild without the orphan key (immutably; deepSetPath returns fresh objs).
      const { [orphanKey]: _removed, ...rest } = draft
      void _removed
      draft = rest
      changed = true
      log.push(`  DELETED orphan key "${orphanKey}"`)
    } else {
      log.push(`  KEPT orphan key "${orphanKey}" (has unresolved conflicts)`)
    }
  }

  // Copy repaired fields back onto the caller's schema object reference.
  if (changed) {
    for (const k of Object.keys(schema)) delete schema[k]
    Object.assign(schema, draft)
  }
  return changed
}

// Ensure "emojis" is present in brand.toneToAvoid for the target session.
function ensureEmojiRule(schema: Obj, log: string[]): boolean {
  const brand = isPlainObj(schema.brand) ? schema.brand : {}
  const cur = brand.toneToAvoid
  const list = Array.isArray(cur) ? (cur as unknown[]) : cur == null ? [] : [cur]
  if (list.some(x => typeof x === 'string' && x.toLowerCase().includes('emoji'))) return false
  const next = [...list, 'emojis']
  Object.assign(schema, deepSetPath(schema, 'brand.toneToAvoid', next))
  log.push(`  ADDED brand.toneToAvoid ← "emojis"`)
  return true
}

async function main() {
  console.log(apply ? '— APPLY mode —' : '— dry run (use --apply to write) —')

  let query = supabase.from('sessions').select('id, schema_data')
  if (onlySession) query = query.eq('id', onlySession)
  const { data: sessions, error } = await query
  if (error) throw error
  if (onlySession) console.log(`Scoped to session ${onlySession}`)

  let touched = 0
  let conflicts = 0
  for (const row of sessions ?? []) {
    const original = (row.schema_data ?? {}) as Obj
    if (!original || typeof original !== 'object') continue
    const log: string[] = []
    // Deep clone so we only write when something actually changed.
    const draft = JSON.parse(JSON.stringify(original)) as Obj

    let changed = repairSchema(draft, log)
    if (row.id === EMOJI_SESSION_ID) changed = ensureEmojiRule(draft, log) || changed

    if (!changed && !log.length) continue
    touched++
    conflicts += log.filter(l => l.startsWith('  CONFLICT')).length
    console.log(`\nsession ${row.id}:`)
    for (const l of log) console.log(l)

    if (apply && changed) {
      const { error: wErr } = await supabase.from('sessions').update({ schema_data: draft }).eq('id', row.id)
      if (wErr) console.error(`  write failed: ${wErr.message}`)
      else console.log('  ✓ written')
    }
  }

  console.log(`\nSessions touched: ${touched}   Unresolved conflicts: ${conflicts}`)
  if (conflicts) console.log('Conflicts were left in place for manual review (orphan key kept).')
  if (!apply) console.log('Dry run only. Re-run with --apply to commit changes.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
