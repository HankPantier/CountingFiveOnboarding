#!/usr/bin/env tsx
/**
 * Bulk-regenerate content pages for a given content_job.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/bulk-regenerate.ts <contentJobId>
 *   npx tsx --env-file=.env.local scripts/bulk-regenerate.ts <contentJobId> --all
 *
 * Without --all: only regenerates pages whose content_markdown is missing
 * inline block annotations (the M2 retrofit case).
 * With --all: regenerates every approved-outline page regardless of state.
 *
 * Batches calls in groups of 3 (matching runContentGeneration).
 */

import { createServerClient } from '../lib/supabase/server'
import { generateSinglePage } from '../lib/content/content-generator'

function countAnnotations(md: string): { headings: number; nonFaqAnnotations: number } {
  const headings = (md.match(/^##\s+/gm) || []).length
  const allAnnotations = (md.match(/<!--\s*block:/g) || []).length
  const faqAnnotations = (md.match(/<!--\s*block:\s*faq-accordion/g) || []).length
  return { headings, nonFaqAnnotations: allAnnotations - faqAnnotations }
}

async function main(): Promise<void> {
  const contentJobId = process.argv[2]
  if (!contentJobId) {
    console.error('Usage: npx tsx --env-file=.env.local scripts/bulk-regenerate.ts <contentJobId> [--all]')
    process.exit(1)
  }
  const forceAll = process.argv.includes('--all')

  const supabase = createServerClient()

  const { data: outlines, error: outlinesErr } = await supabase
    .from('page_outlines')
    .select('id, page_url, page_title')
    .eq('content_job_id', contentJobId)
    .eq('admin_approved', true)
    .order('created_at', { ascending: true })

  if (outlinesErr || !outlines?.length) {
    console.error('No approved outlines for', contentJobId, '—', outlinesErr?.message ?? '(empty)')
    process.exit(1)
  }

  let targets = outlines
  if (!forceAll) {
    const { data: pages } = await supabase
      .from('generated_pages')
      .select('page_url, content_markdown')
      .eq('content_job_id', contentJobId)
    const staleUrls = new Set<string>()
    for (const p of pages ?? []) {
      const md = p.content_markdown ?? ''
      if (!md) continue
      const { headings, nonFaqAnnotations } = countAnnotations(md)
      // Heuristic: if body has 2+ headings and 0 non-FAQ annotations, it's stale.
      // Single-heading pages (rare) or pages with at least one annotation are kept.
      if (headings >= 2 && nonFaqAnnotations === 0) {
        staleUrls.add(p.page_url)
      }
    }
    targets = outlines.filter(o => staleUrls.has(o.page_url))
    console.log(`Detected ${targets.length} of ${outlines.length} page(s) missing block annotations`)
    if (targets.length === 0) {
      console.log('Nothing to regenerate. Pass --all to force a full rebuild.')
      return
    }
  } else {
    console.log(`Force-regenerating all ${outlines.length} page(s)`)
  }

  const BATCH_SIZE = 3
  const startedAt = Date.now()
  let completed = 0
  let errors = 0

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE)
    const labels = batch.map(o => o.page_url).join(', ')
    console.log(`\n[batch ${Math.floor(i / BATCH_SIZE) + 1}] ${labels}`)
    const results = await Promise.all(batch.map(o => generateSinglePage(contentJobId, o.id)))
    for (const r of results) {
      if (r.status === 'complete') {
        completed += 1
        console.log(`  ✓ ${r.pageUrl}`)
      } else {
        errors += 1
        console.log(`  ✗ ${r.pageUrl} — ${r.error ?? 'unknown error'}`)
      }
    }
  }

  const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1)
  console.log(`\nDone in ${elapsedMin} min — ${completed} complete, ${errors} error(s).`)
  console.log('Re-download the deliverable package from the admin UI to get the refreshed content.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
