// One-shot data fix: dedupe sitemap rows by URL on existing sessions and
// content_jobs that were populated before lib/mfp-parser/index.ts learned to
// skip duplicate destination URLs.
//
// Usage:
//   npx tsx scripts/dedupe-existing-sitemaps.ts          # dry run
//   npx tsx scripts/dedupe-existing-sitemaps.ts --apply  # write changes

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import type { SessionSchema } from '../types/session-schema'

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

type SitemapPage = NonNullable<SessionSchema['proposed_sitemap']>[number]

function dedupe(pages: SitemapPage[]): { pages: SitemapPage[]; removed: number } {
  const seen = new Set<string>()
  const out: SitemapPage[] = []
  for (const p of pages) {
    if (seen.has(p.url)) continue
    seen.add(p.url)
    out.push(p)
  }
  return { pages: out, removed: pages.length - out.length }
}

async function main() {
  console.log(apply ? '— APPLY mode —' : '— dry run (use --apply to write) —')

  // Sessions: schema_data.proposed_sitemap
  const { data: sessions, error: sErr } = await supabase
    .from('sessions')
    .select('id, schema_data')
  if (sErr) throw sErr

  let sessionTouched = 0
  for (const row of sessions ?? []) {
    const schema = (row.schema_data ?? {}) as Record<string, unknown>
    const proposed = (schema.proposed_sitemap as SitemapPage[] | undefined) ?? []
    if (proposed.length === 0) continue
    const { pages, removed } = dedupe(proposed)
    if (removed === 0) continue
    sessionTouched++
    console.log(`session ${row.id}: removed ${removed} duplicate URL(s)`)
    if (apply) {
      const next = { ...schema, proposed_sitemap: pages }
      const { error } = await supabase
        .from('sessions')
        .update({ schema_data: next })
        .eq('id', row.id)
      if (error) console.error(`  write failed: ${error.message}`)
    }
  }

  // Content jobs: confirmed_sitemap
  const { data: jobs, error: jErr } = await supabase
    .from('content_jobs')
    .select('id, confirmed_sitemap')
  if (jErr) throw jErr

  let jobTouched = 0
  for (const row of jobs ?? []) {
    const confirmed = (row.confirmed_sitemap as SitemapPage[] | null) ?? null
    if (!confirmed || confirmed.length === 0) continue
    const { pages, removed } = dedupe(confirmed)
    if (removed === 0) continue
    jobTouched++
    console.log(`content_job ${row.id}: removed ${removed} duplicate URL(s)`)
    if (apply) {
      const { error } = await supabase
        .from('content_jobs')
        .update({ confirmed_sitemap: pages })
        .eq('id', row.id)
      if (error) console.error(`  write failed: ${error.message}`)
    }
  }

  // Seeded research/outline/generation rows: dedupe by (content_job_id, page_url).
  // These were inserted from confirmed_sitemap, so any duplicate URL there caused
  // two rows. Both were processed by the pipeline, so we keep whichever row got
  // further along (status complete > running > pending > error; populated fields
  // beat null) and drop the rest.
  const STATUS_RANK: Record<string, number> = { complete: 3, running: 2, pending: 1, error: 0 }
  const tableSpecs = [
    { name: 'research_results', select: 'id, content_job_id, page_url, research_status, target_keyword, existing_content, created_at', statusCol: 'research_status', contentCols: ['target_keyword', 'existing_content'] },
    { name: 'page_outlines',    select: 'id, content_job_id, page_url, h1, sections, admin_approved, created_at',                  statusCol: null,               contentCols: ['h1', 'sections'] },
    { name: 'generated_pages',  select: 'id, content_job_id, page_url, generation_status, content_markdown, created_at',           statusCol: 'generation_status', contentCols: ['content_markdown'] },
  ] as const

  for (const spec of tableSpecs) {
    const { data: rows, error } = await supabase
      .from(spec.name)
      .select(spec.select)
      .order('created_at', { ascending: true })
    if (error) throw error

    const groups = new Map<string, Array<Record<string, unknown>>>()
    for (const r of (rows ?? []) as unknown as Array<Record<string, unknown>>) {
      const key = `${r.content_job_id}::${r.page_url}`
      const list = groups.get(key) ?? []
      list.push(r)
      groups.set(key, list)
    }

    const drop: string[] = []
    for (const [key, list] of groups) {
      if (list.length < 2) continue
      const score = (r: Record<string, unknown>): number => {
        let s = 0
        if (spec.statusCol) {
          const status = String(r[spec.statusCol] ?? '')
          s += (STATUS_RANK[status] ?? 0) * 100
        }
        for (const col of spec.contentCols) {
          const v = r[col]
          if (v === null || v === undefined) continue
          if (typeof v === 'string' && v.trim() === '') continue
          if (Array.isArray(v) && v.length === 0) continue
          s += 10
        }
        return s
      }
      const sorted = [...list].sort((a, b) => score(b) - score(a) || String(a.created_at).localeCompare(String(b.created_at)))
      const kept = sorted[0]
      console.log(`  ${spec.name} ${key}: keeping id=${kept.id} score=${score(kept)}; dropping ${sorted.length - 1}`)
      for (const r of sorted.slice(1)) drop.push(r.id as string)
    }

    if (drop.length === 0) continue
    console.log(`${spec.name}: removing ${drop.length} duplicate row(s)`)
    if (apply) {
      const { error: dErr } = await supabase.from(spec.name).delete().in('id', drop)
      if (dErr) console.error(`  delete failed: ${dErr.message}`)
    }
  }

  console.log(`\nSessions touched: ${sessionTouched}, content_jobs touched: ${jobTouched}`)
  if (!apply) console.log('Dry run only. Re-run with --apply to commit changes.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
