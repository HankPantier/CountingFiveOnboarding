// Data fix: coerce ARRAY-declared schema_data fields that got stored as
// a non-array (a string, from an AI draft/import/hand edit) back into a clean
// string/object array. `?? []` doesn't guard a stringy value, so the content
// generators threw "(t ?? []).filter is not a function" (see brand-voice.ts arr()
// helper — the runtime is now defensive; this normalizes the stored data).
//
// Also strips the corruption a stale-index bracket-path write leaves behind:
// `null` holes in object arrays (JSONB persists a sparse slot as null) and the
// nameless stub/orphan objects those writes create. schema-write.ts now refuses
// out-of-range writes, so this only has to clean up what already landed.
//
// Usage:
//   npx tsx scripts/repair-nonarray-schema-fields.ts <sessionId>          # dry run
//   npx tsx scripts/repair-nonarray-schema-fields.ts <sessionId> --apply  # write
//   npx tsx scripts/repair-nonarray-schema-fields.ts --all                # scan all (dry)
//   npx tsx scripts/repair-nonarray-schema-fields.ts --all --apply        # scan+fix all
//   ... --drop-orphans     # also drop rows that have content but no name

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

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
const all = process.argv.includes('--all')
// Rows that carry real content but no name are unusable by every generator, yet
// they are still work product. Keep + report them by default; drop only when the
// operator has reviewed the dry run and asked for it.
const dropOrphans = process.argv.includes('--drop-orphans')
const sessionId = process.argv.find((a) => /^[0-9a-f-]{36}$/i.test(a))
if (!all && !sessionId) {
  console.error('Provide a <sessionId> or --all')
  process.exit(1)
}

const supabase = createClient(url, serviceKey)

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

// The array-declared fields in SessionSchema, addressed by dotted path.
const STRING_ARRAY_PATHS = [
  'business.idealClients',
  'business.clientAgeRanges',
  'business.affiliations',
  'business.clientSuccessStories',
  'business.contentEmphasis',
  'business.contentExclusions',
  'business.targetKeywords',
  'brand.toneAdjectives',
  'brand.toneToAvoid',
  'culture.socialMediaChannels',
  'reputation.pressAndMedia',
  'reputation.trustSignalGaps',
]
// Object-array fields — a stringy value can't be recovered into structured rows,
// so we can only null it out (report loudly).
const OBJECT_ARRAY_PATHS = ['services', 'niches', 'team', 'locations', 'business.competitors', 'business.serviceAreas']

function getPath(root: Obj, dotted: string): { parent: Obj; key: string; value: unknown } | null {
  const parts = dotted.split('.')
  let cur: unknown = root
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isObj(cur)) return null
    cur = cur[parts[i]]
  }
  if (!isObj(cur)) return null
  return { parent: cur, key: parts[parts.length - 1], value: cur[parts[parts.length - 1]] }
}

// A stringy value → array: split on common delimiters when present, else a
// single trimmed element. Non-string non-array → [] (unrecoverable).
function toStringArray(v: unknown): string[] {
  if (typeof v !== 'string') return []
  const s = v.trim()
  if (!s) return []
  const parts = /[,;\n•|]/.test(s) ? s.split(/[,;\n•|]+/) : [s]
  return parts.map((p) => p.trim()).filter(Boolean)
}

// A stringified JSON payload that landed in a structured slot. Tolerates the
// trailing commas an AI draft leaves behind, which plain JSON.parse rejects.
function tryParseJsonish(v: unknown): unknown {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  if (!/^[[{]/.test(t)) return undefined
  for (const candidate of [t, t.replace(/,(\s*[}\]])/g, '$1')]) {
    try {
      return JSON.parse(candidate)
    } catch {
      /* try the next form */
    }
  }
  return undefined
}

// A string written where an object was expected gets spread character-by-
// character, leaving { "0": "{", "1": "\"", ... }. Reassemble and re-parse.
function fromCharIndexedObject(v: unknown): unknown {
  if (!isObj(v)) return undefined
  const keys = Object.keys(v)
  if (keys.length < 2) return undefined
  if (!keys.every((k, i) => k === String(i))) return undefined
  if (!keys.every((k) => typeof v[k] === 'string' && (v[k] as string).length === 1)) return undefined
  return tryParseJsonish(keys.map((k) => v[k]).join(''))
}

// Object arrays that a stale-index write can pollute with null holes and
// nameless stubs. Keys that carry no real content: a bare {status:'dropped'} or
// an orphan fragment with no name is unusable by every consumer.
const HOLED_ARRAY_PATHS = ['niches', 'services', 'team', 'locations']

// Identity keys per path: a row with none of them can't be matched, rendered or
// generated from by any consumer, whatever else it carries. niches[7..9] on the
// Berg session are exactly this — orphan valueProp/painPoints fragments a
// stale-index write dropped next to the real rows.
const IDENTITY_KEYS: Record<string, string[]> = {
  niches: ['name'],
  services: ['name'],
  team: ['name'],
  locations: ['name', 'city', 'street'],
}

// Review bookkeeping, not content: a row carrying only these is a stub left by a
// keep/drop write that landed at a stale index, not salvageable work.
const META_KEYS = new Set([
  'status', 'pageTreatment', 'origin', 'parent', 'teamDecision', 'signal',
])

type RowVerdict = 'keep' | 'empty' | 'orphan'

// 'empty'  — a hole or a stub with neither identity nor content. Always dropped.
// 'orphan' — real content but no identity, so no generator or UI can use it.
//            Kept + reported unless --drop-orphans.
function classifyRow(path: string, v: unknown): RowVerdict {
  if (!isObj(v)) return 'empty'
  const hasIdentity = (IDENTITY_KEYS[path] ?? ['name']).some((k) => {
    const val = v[k]
    return typeof val === 'string' && val.trim().length > 0
  })
  if (hasIdentity) return 'keep'
  const hasContent = Object.entries(v)
    .filter(([k]) => !META_KEYS.has(k))
    .map(([, val]) => val)
    .some((val) =>
    (typeof val === 'string' && val.trim().length > 0) ||
    (Array.isArray(val) && val.length > 0) ||
    (isObj(val) && Object.keys(val).length > 0)
  )
  return hasContent ? 'orphan' : 'empty'
}

function describe(v: unknown): string {
  const j = JSON.stringify(v) ?? 'null'
  return j.length > 120 ? j.slice(0, 117) + '...' : j
}

async function repairSession(id: string): Promise<boolean> {
  const { data, error } = await supabase.from('sessions').select('id, schema_data').eq('id', id).single()
  if (error || !data) {
    console.error(`  ! ${id}: ${error?.message ?? 'not found'}`)
    return false
  }
  const schema = (data.schema_data ?? {}) as Obj
  const changes: string[] = []

  for (const p of STRING_ARRAY_PATHS) {
    const hit = getPath(schema, p)
    if (!hit || hit.value == null || Array.isArray(hit.value)) continue
    const fixed = toStringArray(hit.value)
    changes.push(`  ${p}: ${JSON.stringify(hit.value)}  ->  ${JSON.stringify(fixed)}`)
    hit.parent[hit.key] = fixed
  }
  for (const p of OBJECT_ARRAY_PATHS) {
    const hit = getPath(schema, p)
    if (!hit || hit.value == null || Array.isArray(hit.value)) continue
    const parsed = tryParseJsonish(hit.value)
    if (Array.isArray(parsed)) {
      const rows = parsed.filter(isObj)
      changes.push(`  ${p}: stringified JSON  ->  recovered ${rows.length} row(s)`)
      hit.parent[hit.key] = rows
      continue
    }
    changes.push(`  ${p}: ${describe(hit.value)}  ->  []  (object-array, value unrecoverable)`)
    hit.parent[hit.key] = []
  }

  for (const p of HOLED_ARRAY_PATHS) {
    const hit = getPath(schema, p)
    if (!hit || !Array.isArray(hit.value)) continue
    const before = hit.value as unknown[]
    // A structured row that got stored as text (or spread character-by-character)
    // is recoverable — rebuild it before judging whether it is junk.
    before.forEach((row, i) => {
      const rebuilt = fromCharIndexedObject(row) ?? tryParseJsonish(row)
      if (!isObj(rebuilt)) return
      changes.push(`  ${p}[${i}]: stringified row  ->  rebuilt ${describe(rebuilt)}`)
      before[i] = rebuilt
    })
    const kept: unknown[] = []
    before.forEach((row, i) => {
      const verdict = classifyRow(p, row)
      if (verdict === 'keep') return kept.push(row)
      if (verdict === 'orphan' && !dropOrphans) {
        changes.push(`  ${p}[${i}]: ORPHAN kept (no name) — rerun with --drop-orphans to remove  ${describe(row)}`)
        return kept.push(row)
      }
      changes.push(`  ${p}[${i}]: dropped (${verdict})  ${describe(row)}`)
    })
    if (kept.length !== before.length) hit.parent[hit.key] = kept
  }

  // Per-niche sub-services stored as a string (niches[i].subCategories).
  const nicheList = getPath(schema, 'niches')
  if (nicheList && Array.isArray(nicheList.value)) {
    ;(nicheList.value as unknown[]).forEach((row, i) => {
      if (!isObj(row)) return
      const subs = row.subCategories
      if (subs == null || Array.isArray(subs)) return
      changes.push(`  niches[${i}].subCategories: ${describe(subs)}  ->  []  (object-array, value unrecoverable)`)
      row.subCategories = []
    })
  }

  if (changes.length === 0) return false
  console.log(`\n${id} — ${changes.length} dirty field(s):`)
  console.log(changes.join('\n'))

  if (apply) {
    const { error: upErr } = await supabase.from('sessions').update({ schema_data: schema }).eq('id', id)
    if (upErr) {
      console.error(`  ! write failed: ${upErr.message}`)
      return false
    }
    console.log('  ✓ written')
  }
  return true
}

async function main() {
  console.log(apply ? '=== APPLY (writing) ===' : '=== DRY RUN (no writes) ===')
  if (sessionId) {
    await repairSession(sessionId)
  } else {
    const { data, error } = await supabase.from('sessions').select('id')
    if (error || !data) {
      console.error(error?.message ?? 'no sessions')
      process.exit(1)
    }
    let count = 0
    for (const row of data) if (await repairSession(row.id)) count++
    console.log(`\nScanned ${data.length} sessions; ${count} had dirty array fields.`)
  }
}

void main()
