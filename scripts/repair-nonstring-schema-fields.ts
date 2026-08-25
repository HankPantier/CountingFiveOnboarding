// One-shot data fix: coerce non-string values back to strings on schema_data
// fields the content generators call string methods (.trim/.slice) on. Some
// sessions stored an array/object where the schema declares `string` (from an AI
// draft/import/hand edit); .trim() on it threw a TypeError that both the outline
// and page-body generators swallowed into a generic "generation failed" note.
// The code is now defensive (lib/content/brand-voice.ts), but this normalizes the
// stored data so painPoints & friends read back as clean strings.
//
// Usage:
//   npx tsx scripts/repair-nonstring-schema-fields.ts          # dry run
//   npx tsx scripts/repair-nonstring-schema-fields.ts --apply  # write changes

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
const supabase = createClient(url, serviceKey)

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

// Same coercion the runtime helper uses: string→as-is, array→comma list of its
// string members, other primitives→String(), objects→'' (drop — no meaningful
// text). Returns null when nothing should change (already a string / absent).
function coerce(v: unknown): { changed: boolean; value: string } | null {
  if (typeof v === 'string' || v === undefined || v === null) return null
  if (Array.isArray(v)) {
    return { changed: true, value: v.filter((x): x is string => typeof x === 'string').join(', ') }
  }
  if (isObj(v)) return { changed: true, value: '' }
  return { changed: true, value: String(v) }
}

// Fix one scalar field on a record in place; record the change for logging.
function fixField(rec: Obj, field: string, where: string, log: string[]): boolean {
  const res = coerce(rec[field])
  if (!res) return false
  log.push(`    ${where}.${field}: ${JSON.stringify(rec[field])} → ${JSON.stringify(res.value)}`)
  rec[field] = res.value
  return true
}

// The exact fields the generators (lib/content/brand-voice.ts) call string
// methods on — the throw surface. Coercing these makes the stored data safe.
const NICHE_FIELDS = ['name', 'description', 'icp', 'painPoints', 'valueProp']
const COMPETITOR_FIELDS = ['name', 'nicheClaim', 'positioningNotes']
const REPUTATION_FIELDS = ['googleRating', 'yelpRating', 'reviewSummary']
const BRAND_FIELDS = ['brandPersonality', 'voiceExample']

function repairSchema(schema: Obj, log: string[]): boolean {
  let changed = false

  const niches = schema.niches
  if (Array.isArray(niches)) {
    niches.forEach((n, i) => {
      if (isObj(n)) for (const f of NICHE_FIELDS) changed = fixField(n, f, `niches[${i}]`, log) || changed
    })
  }

  const biz = schema.business
  if (isObj(biz)) {
    const comps = biz.competitors
    if (Array.isArray(comps)) {
      comps.forEach((c, i) => {
        if (isObj(c)) for (const f of COMPETITOR_FIELDS) changed = fixField(c, f, `business.competitors[${i}]`, log) || changed
      })
    }
    const stories = biz.clientSuccessStories
    if (Array.isArray(stories)) {
      const next = stories.map(s => (typeof s === 'string' ? s : coerce(s)?.value ?? ''))
      if (JSON.stringify(next) !== JSON.stringify(stories)) {
        log.push(`    business.clientSuccessStories: normalized ${stories.length} entr(y/ies) to strings`)
        biz.clientSuccessStories = next
        changed = true
      }
    }
  }

  const rep = schema.reputation
  if (isObj(rep)) for (const f of REPUTATION_FIELDS) changed = fixField(rep, f, 'reputation', log) || changed

  const brand = schema.brand
  if (isObj(brand)) for (const f of BRAND_FIELDS) changed = fixField(brand, f, 'brand', log) || changed

  return changed
}

async function main() {
  console.log(apply ? '— APPLY mode —' : '— dry run (use --apply to write) —')

  const { data: sessions, error } = await supabase.from('sessions').select('id, schema_data')
  if (error) throw error

  let touched = 0
  for (const row of sessions ?? []) {
    const schema = (row.schema_data ?? {}) as Obj
    if (!schema || typeof schema !== 'object') continue
    const log: string[] = []
    // Deep clone so we only write when something actually changed.
    const draft = JSON.parse(JSON.stringify(schema)) as Obj
    const changed = repairSchema(draft, log)
    if (!changed) continue
    touched++
    console.log(`\nsession ${row.id}:`)
    for (const l of log) console.log(l)
    if (apply) {
      const { error: wErr } = await supabase.from('sessions').update({ schema_data: draft }).eq('id', row.id)
      if (wErr) console.error(`  write failed: ${wErr.message}`)
      else console.log('  ✓ written')
    }
  }

  console.log(`\nSessions with non-string fields: ${touched}`)
  if (!apply) console.log('Dry run only. Re-run with --apply to commit changes.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
