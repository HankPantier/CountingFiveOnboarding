// One-off data repair: drop internal_links metadata entries that point
// outside the job's confirmed sitemap. Pages generated before the prompt
// carried the sitemap list have hallucinated paths (/team, /services/
// bookkeeping); the template never renders these, but they fail the
// package-time link gate. Run with:
//   npx tsx scripts/scrub-internal-links.ts <contentJobId>
import { createServerClient } from '../lib/supabase/server'
import { asJson } from '../lib/supabase/json-typed'

const jobId = process.argv[2]
if (!jobId) throw new Error('usage: scrub-internal-links.ts <contentJobId>')

function normalize(url: string): string {
  const noTrailing = url.replace(/\/+$/, '')
  return noTrailing === '' ? '/' : noTrailing
}

async function main() {
  const supabase = createServerClient()
  const { data: job } = await supabase
    .from('content_jobs')
    .select('confirmed_sitemap')
    .eq('id', jobId)
    .single()
  if (!job) throw new Error('job not found')

  const known = new Set(
    ((job.confirmed_sitemap as Array<{ url?: string }>) ?? [])
      .map((s) => (typeof s.url === 'string' ? normalize(s.url) : null))
      .filter((u): u is string => !!u)
  )
  known.add('/')

  const { data: pages } = await supabase
    .from('generated_pages')
    .select('id, page_url, internal_links')
    .eq('content_job_id', jobId)

  let pagesTouched = 0
  let dropped = 0
  for (const page of pages ?? []) {
    const links = Array.isArray(page.internal_links)
      ? (page.internal_links as Array<{ url?: unknown }>)
      : []
    if (links.length === 0) continue
    const kept = links.filter(
      (l) => typeof l?.url === 'string' && l.url.startsWith('/') && known.has(normalize(l.url))
    )
    if (kept.length === links.length) continue

    const removed = links.filter((l) => !kept.includes(l))
    console.log(
      `${page.page_url}: dropping ${removed.length}/${links.length} → ${removed
        .map((l) => l.url)
        .join(', ')}`
    )
    const { error } = await supabase
      .from('generated_pages')
      .update({ internal_links: asJson(kept) })
      .eq('id', page.id)
    if (error) throw new Error(`update failed for ${page.page_url}: ${error.message}`)
    pagesTouched++
    dropped += removed.length
  }

  console.log(`\nscrubbed ${dropped} hallucinated link(s) across ${pagesTouched} page(s)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
