// READ-ONLY scan: find sessions whose schema_data object arrays carry nameless
// stub rows — the footprint of the chat-route bug (d004e78, 2026-09-17 → fix)
// where a single `niches[2].painPoints` update was folded onto `{}` and then
// replaced the whole stored array with `[{}, {}, { painPoints }]`.
//
// Usage:
//   npx tsx scripts/scan-chat-array-wipe.ts            # all sessions
//   npx tsx scripts/scan-chat-array-wipe.ts <sessionId>

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

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
const supabase = createClient(url, serviceKey)

// [label, getter, identity key]
const ARRAYS: Array<[string, (s: Record<string, unknown>) => unknown, string]> = [
  ['niches', s => s.niches, 'name'],
  ['services', s => s.services, 'name'],
  ['team', s => s.team, 'name'],
  ['locations', s => s.locations, 'city'],
  ['business.serviceAreas', s => (s.business as Record<string, unknown> | undefined)?.serviceAreas, 'city'],
  ['business.competitors', s => (s.business as Record<string, unknown> | undefined)?.competitors, 'name'],
]

function isBlank(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === ''
}

// A stub is a null hole, or an object that carries data but none of the keys
// that identify a row. Plain-string elements and slug/region rows are legitimate
// shapes elsewhere in the schema, not wipe damage.
const IDENTITY_KEYS = ['name', 'city', 'slug', 'region', 'title']
function isStub(el: unknown, key: string): boolean {
  if (el === null) return true
  if (typeof el !== 'object') return false
  const row = el as Record<string, unknown>
  return [key, ...IDENTITY_KEYS].every(k => isBlank(row[k]))
}

async function main() {
  const only = process.argv[2]
  let q = supabase
    .from('sessions')
    .select('id, status, current_phase, last_activity_at, schema_data')
    .order('last_activity_at', { ascending: false })
  if (only) q = q.eq('id', only)
  const { data, error } = await q
  if (error) throw error

  let hits = 0
  for (const row of data ?? []) {
    const schema = (row.schema_data ?? {}) as Record<string, unknown>
    const findings: string[] = []
    for (const [label, get, key] of ARRAYS) {
      const arr = get(schema)
      if (!Array.isArray(arr) || arr.length === 0) continue
      const stubs = arr.filter(el => isStub(el, key)).length
      if (stubs > 0) findings.push(`${label}: ${stubs}/${arr.length} nameless`)
    }
    // Nested: niches[i].subCategories
    if (Array.isArray(schema.niches)) {
      schema.niches.forEach((n, i) => {
        const subs = (n as Record<string, unknown> | null)?.subCategories
        if (!Array.isArray(subs) || subs.length === 0) return
        const stubs = subs.filter(el => isStub(el, 'name')).length
        if (stubs > 0) findings.push(`niches[${i}].subCategories: ${stubs}/${subs.length} nameless`)
      })
    }
    if (!findings.length) continue
    hits++
    const biz = (schema.business as Record<string, unknown> | undefined)?.name ?? '(no name)'
    console.log(
      `${row.id}  ${String(biz)}  phase=${row.current_phase} status=${row.status} last=${row.last_activity_at}\n    ${findings.join('\n    ')}`
    )
  }
  console.log(`\n${hits} of ${data?.length ?? 0} sessions have nameless array rows.`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
