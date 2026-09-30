// One-off eval: write the same approved outlines with two writer models through
// the production page path (generateAndFinalizePage: prompt, retries, validator,
// deterministic fixes), then grade every draft with the SAME judge (the Opus 5.5
// production critic by default) so a writer-model change is decided on evidence.
// Read-only against content (nothing is persisted to generated_pages); each call
// still records its real spend to token_usage, which is also where the per-model
// cost below is read from.
//
// Usage:
//   npx tsx scripts/compare-content-models.ts                          # 5 most recent approved outlines
//   npx tsx scripts/compare-content-models.ts 8                        # N outlines
//   npx tsx scripts/compare-content-models.ts 5 claude-sonnet-5 claude-sonnet-5-5 [judge]

import * as fs from 'fs'
import * as path from 'path'

const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

type Row = { model: string; page: string; secs: number; words: number; score: number | null; claims: number | null; missing: number | null; cost: number }

async function main() {
  const { createServerClient } = await import('../lib/supabase/server')
  const { loadPageGenContext, buildFinalizeInput, generateAndFinalizePage, OUTLINE_SELECT } =
    await import('../lib/content/content-generator')
  type OutlineRow = import('../lib/content/content-generator').OutlineRow
  type PageGenContext = import('../lib/content/content-generator').PageGenContext
  const { PER_CALL_CAP_MS } = await import('../lib/content/generation-budget')
  const { scoreDraft } = await import('../lib/content/draft-critic')
  const { PUBLISHED_CONTENT_MODEL, SONNET_5_5_CHALLENGER, CRITIC_MODEL } = await import('../lib/content/generation-tuning')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey || !process.env.ANTHROPIC_API_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or ANTHROPIC_API_KEY')
    process.exit(1)
  }
  const supabase = createServerClient()

  const args = process.argv.slice(2)
  const limit = Number(args[0] ?? 5) || 5
  const models = [args[1] ?? PUBLISHED_CONTENT_MODEL, args[2] ?? SONNET_5_5_CHALLENGER]
  const judge = args[3] ?? CRITIC_MODEL
  if (models.includes(judge)) console.warn(`WARNING: judge ${judge} is also a contender — scores are self-graded`)

  const { data: outlines, error } = await supabase
    .from('page_outlines')
    .select(`${OUTLINE_SELECT}, content_job_id`)
    .eq('admin_approved', true)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  const ctxByJob = new Map<string, PageGenContext | null>()
  const rows: Row[] = []

  for (const o of (outlines ?? []) as Array<OutlineRow & { content_job_id: string }>) {
    if (!ctxByJob.has(o.content_job_id)) ctxByJob.set(o.content_job_id, await loadPageGenContext(supabase, o.content_job_id))
    const ctx = ctxByJob.get(o.content_job_id)
    if (!ctx) {
      console.warn(`skip ${o.page_url}: job/session not found`)
      continue
    }

    const runOne = async (model: string): Promise<Row> => {
      const startedAt = new Date().toISOString()
      const t = Date.now()
      const input = buildFinalizeInput(o, ctx, o.content_job_id, {
        attemptNumber: 1,
        callTimeoutMs: PER_CALL_CAP_MS,
        deadlineAt: Date.now() + 10 * 60_000,
      })
      const result = await generateAndFinalizePage({ ...input, modelId: model })
      const secs = (Date.now() - t) / 1000
      const review = result.degraded
        ? null
        : await scoreDraft(
            {
              pageId: o.id,
              pageUrl: o.page_url,
              pageTitle: o.page_title,
              contentMarkdown: result.content,
              outlineSections: o.sections,
              targetKeyword: input.targetKeyword,
              competitorRefs: input.competitorRefs,
              schema: ctx.schema,
              sessionId: ctx.sessionId,
              contentJobId: o.content_job_id,
            },
            judge,
          )
      const { data: usage } = await supabase
        .from('token_usage')
        .select('cost_usd')
        .eq('content_job_id', o.content_job_id)
        .eq('stage', 'content')
        .eq('model', model)
        .eq('page_url', o.page_url)
        .gte('created_at', startedAt)
      const scores = review
        ? [
            review.evidence_specificity, review.information_gain, review.brand_fidelity, review.promise_fulfillment,
            review.outline_coverage ?? 0, review.input_utilization ?? 0, review.differentiation ?? 0,
          ]
        : null
      return {
        model,
        page: o.page_url,
        secs,
        words: result.content.split(/\s+/).filter(Boolean).length,
        score: scores ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
        claims: review ? review.unsupported_claims.length : null,
        missing: review ? (review.missing_sections ?? []).length : null,
        cost: (usage ?? []).reduce((s, r) => s + Number(r.cost_usd), 0),
      }
    }

    const pair = await Promise.all(models.map((m) => runOne(m).catch((err): Row => {
      console.error(`  ${m} failed on ${o.page_url}:`, err)
      return { model: m, page: o.page_url, secs: 0, words: 0, score: null, claims: null, missing: null, cost: 0 }
    })))
    console.warn(`\n=== ${o.page_url}`)
    for (const r of pair) {
      console.warn(`  ${r.model.padEnd(20)} ${r.secs.toFixed(0)}s  ${r.words}w  score=${r.score?.toFixed(2) ?? 'FAIL'}  claims=${r.claims ?? '-'}  missing=${r.missing ?? '-'}  $${r.cost.toFixed(3)}`)
    }
    rows.push(...pair)
  }

  console.warn(`\n=== SUMMARY (judge: ${judge}, ${rows.length / models.length} pages)`)
  for (const m of models) {
    const mine = rows.filter((r) => r.model === m)
    const scored = mine.filter((r) => r.score !== null)
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
    console.warn(
      `  ${m.padEnd(20)} mean score=${avg(scored.map((r) => r.score as number)).toFixed(2)}` +
        `  claims/page=${avg(scored.map((r) => r.claims as number)).toFixed(1)}` +
        `  missing/page=${avg(scored.map((r) => r.missing as number)).toFixed(1)}` +
        `  secs/page=${avg(mine.map((r) => r.secs)).toFixed(0)}` +
        `  $/page=${avg(mine.map((r) => r.cost)).toFixed(3)}` +
        `  failures=${mine.length - scored.length}`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
