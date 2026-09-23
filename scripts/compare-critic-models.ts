// One-off eval: grade the same finished pages with two critic models side by side
// so a critic-model change is decided on evidence, not vibes. Read-only against
// content (nothing is persisted to generated_pages); each call still records its
// real spend to token_usage like any critic run.
//
// Usage:
//   npx tsx scripts/compare-critic-models.ts                 # 5 most recent critic-scored pages
//   npx tsx scripts/compare-critic-models.ts 8               # N pages
//   npx tsx scripts/compare-critic-models.ts 5 claude-sonnet-5 claude-opus-5-5

import * as fs from 'fs'
import * as path from 'path'

const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

type CompetitorRef = { url: string; title: string; excerpt: string }

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { scoreDraft } = await import('../lib/content/draft-critic')
  type SessionSchema = import('../types/session-schema').SessionSchema

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey || !process.env.ANTHROPIC_API_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or ANTHROPIC_API_KEY')
    process.exit(1)
  }
  const supabase = createClient(url, serviceKey)

  const args = process.argv.slice(2)
  const limit = Number(args[0] ?? 5) || 5
  const modelA = args[1] ?? 'claude-sonnet-5'
  const modelB = args[2] ?? 'claude-opus-5-5'

  const { data: pages, error } = await supabase
    .from('generated_pages')
    .select('id, content_job_id, page_url, page_title, content_markdown, target_keyword')
    .eq('generation_status', 'complete')
    .not('critic_review', 'is', null)
    .not('content_markdown', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  for (const page of pages ?? []) {
    const [{ data: job }, { data: outline }, { data: research }] = await Promise.all([
      supabase.from('content_jobs').select('session_id').eq('id', page.content_job_id).single(),
      supabase
        .from('page_outlines')
        .select('sections')
        .eq('content_job_id', page.content_job_id)
        .eq('page_url', page.page_url)
        .maybeSingle(),
      supabase
        .from('research_results')
        .select('competitor_references')
        .eq('content_job_id', page.content_job_id)
        .eq('page_url', page.page_url)
        .limit(1)
        .maybeSingle(),
    ])
    if (!job?.session_id || !outline) {
      console.warn(`skip ${page.page_url}: missing job/outline`)
      continue
    }
    const { data: session } = await supabase
      .from('sessions')
      .select('schema_data')
      .eq('id', job.session_id)
      .single()
    if (!session) continue

    const input = {
      pageId: page.id,
      pageUrl: page.page_url,
      pageTitle: page.page_title,
      contentMarkdown: page.content_markdown ?? '',
      outlineSections: outline.sections,
      targetKeyword: page.target_keyword ?? page.page_title,
      competitorRefs: (research?.competitor_references as CompetitorRef[] | null) ?? [],
      schema: session.schema_data as SessionSchema,
      sessionId: job.session_id,
      contentJobId: page.content_job_id,
    }

    const timed = async (model: string) => {
      const t = Date.now()
      const review = await scoreDraft(input, model)
      return { review, secs: ((Date.now() - t) / 1000).toFixed(1) }
    }
    const [a, b] = await Promise.all([timed(modelA), timed(modelB)])

    console.warn(`\n=== ${page.page_url}  (${page.id})`)
    for (const [model, r] of [[modelA, a], [modelB, b]] as const) {
      if (!r.review) {
        console.warn(`  ${model} [${r.secs}s]: NO RESULT (generation/parse failure)`)
        continue
      }
      const { review } = r
      const scores = [
        review.evidence_specificity, review.information_gain, review.brand_fidelity,
        review.promise_fulfillment, review.outline_coverage, review.input_utilization,
        review.differentiation,
      ]
      console.warn(`  ${model} [${r.secs}s] scores=${scores.join('/')}`)
      console.warn(`    unsupported_claims (${review.unsupported_claims.length}): ${JSON.stringify(review.unsupported_claims)}`)
      console.warn(`    missing_sections: ${JSON.stringify(review.missing_sections)}`)
      console.warn(`    notes: ${review.notes}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
