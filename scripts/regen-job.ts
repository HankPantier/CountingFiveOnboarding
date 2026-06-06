// Force-regenerate every approved page on a content job (with the current
// prompts), then pre-resolve all stock photos so packaging needs no Pexels
// calls. Run with:
//   npx tsx scripts/regen-job.ts <contentJobId> [--skip-urls=/a,/b]
import { generateSinglePage } from '../lib/content/content-generator'
import { extractInlineImageRefs } from '../lib/content/image-ref-extractor'
import { resolveStockPhotos, type ImageRef } from '../lib/content/stock-photo-resolver'
import { deriveImageStyleSuffix } from '../lib/content/visual-style-derivation'
import { createServerClient } from '../lib/supabase/server'
import type { SessionSchema } from '../types/session-schema'
import type { PaletteData } from '../types/palette'

const jobId = process.argv[2]
if (!jobId) throw new Error('usage: regen-job.ts <contentJobId> [--skip-urls=/a,/b]')
const skipArg = process.argv.find((a) => a.startsWith('--skip-urls='))
const skipUrls = new Set(skipArg ? skipArg.slice('--skip-urls='.length).split(',') : [])

const BATCH_SIZE = 3

async function main() {
  const supabase = createServerClient()

  const { data: outlines } = await supabase
    .from('page_outlines')
    .select('id, page_url')
    .eq('content_job_id', jobId)
    .eq('admin_approved', true)
    .order('created_at', { ascending: true })
  if (!outlines?.length) throw new Error('no approved outlines')

  const todo = outlines.filter((o) => !skipUrls.has(o.page_url))
  console.log(`pages: ${outlines.length} total, ${todo.length} to regenerate, skipping: ${[...skipUrls].join(', ') || '(none)'}`)

  let ok = 0
  const failed: string[] = []
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE)
    await Promise.all(
      batch.map(async (o) => {
        try {
          const res = await generateSinglePage(jobId, o.id)
          if (res.status === 'complete') {
            ok++
            console.log(`  ✓ ${o.page_url}`)
          } else {
            failed.push(`${o.page_url} (${res.status}: ${res.error ?? '?'})`)
            console.log(`  ✗ ${o.page_url}: ${res.status} ${res.error ?? ''}`)
          }
        } catch (err) {
          failed.push(`${o.page_url} (${err instanceof Error ? err.message : String(err)})`)
          console.log(`  ✗ ${o.page_url}: threw`)
        }
      })
    )
    console.log(`— batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(todo.length / BATCH_SIZE)} done (${ok} ok, ${failed.length} failed)`)
  }

  // ---- job-wide stock photo resolution ----
  const { data: job } = await supabase.from('content_jobs').select('session_id, palette').eq('id', jobId).single()
  const { data: session } = await supabase.from('sessions').select('schema_data').eq('id', job!.session_id).single()
  const { data: pages } = await supabase
    .from('generated_pages')
    .select('page_url, content_markdown, hero_image, hero_image_query, generation_status')
    .eq('content_job_id', jobId)

  const refs: ImageRef[] = []
  for (const p of pages ?? []) {
    if (p.generation_status !== 'complete') continue
    if (p.hero_image && p.hero_image_query) {
      refs.push({ pageUrl: p.page_url, filename: p.hero_image, subjectQuery: p.hero_image_query, source: 'hero' })
    }
    refs.push(...extractInlineImageRefs(p.content_markdown ?? '', p.page_url))
  }
  const uniqueFilenames = new Set(refs.map((r) => r.filename))
  console.log(`\nimage refs: ${refs.length} (${uniqueFilenames.size} unique filenames)`)

  const { data: existingAssets } = await supabase.from('assets').select('*').eq('session_id', job!.session_id)
  const schema = (session?.schema_data ?? {}) as SessionSchema
  const styleSuffix = deriveImageStyleSuffix(job!.palette as PaletteData | null, schema.brand)

  const resolved = await resolveStockPhotos(
    {
      sessionId: job!.session_id,
      apiKey: process.env.PEXELS_API_KEY ?? '',
      styleSuffix,
      existingAssets: existingAssets ?? [],
      imageRefs: refs,
    },
    supabase
  )

  console.log(`\n==== SUMMARY ====`)
  console.log(`pages regenerated: ${ok}/${todo.length}`)
  if (failed.length) console.log(`failed:\n  ${failed.join('\n  ')}`)
  console.log(`stock photos resolved this run: ${resolved.length}`)

  // Coverage check: every unique filename should now exist as an asset.
  const { data: postAssets } = await supabase
    .from('assets')
    .select('file_name')
    .eq('session_id', job!.session_id)
  const assetNames = new Set((postAssets ?? []).map((a) => a.file_name))
  const missing = [...uniqueFilenames].filter((f) => !assetNames.has(f))
  console.log(`coverage: ${uniqueFilenames.size - missing.length}/${uniqueFilenames.size} image refs have assets`)
  if (missing.length) console.log(`MISSING (likely Pexels misses/rate limit):\n  ${missing.join('\n  ')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
