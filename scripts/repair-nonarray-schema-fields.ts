// One-shot data fix: coerce ARRAY-declared schema_data fields that got stored as
// a non-array (a string, from an AI draft/import/hand edit) back into a clean
// string/object array. `?? []` doesn't guard a stringy value, so the content
// generators threw "(t ?? []).filter is not a function" (see brand-voice.ts arr()
// helper — the runtime is now defensive; this normalizes the stored data).
//
// Usage:
//   npx tsx scripts/repair-nonarray-schema-fields.ts <sessionId>          # dry run
//   npx tsx scripts/repair-nonarray-schema-fields.ts <sessionId> --apply  # write
//   npx tsx scripts/repair-nonarray-schema-fields.ts --all                # scan all (dry)
//   npx tsx scripts/repair-nonarray-schema-fields.ts --all --apply        # scan+fix all

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
    changes.push(`  ${p}: ${JSON.stringify(hit.value)}  ->  []  (object-array, value unrecoverable)`)
    hit.parent[hit.key] = []
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
