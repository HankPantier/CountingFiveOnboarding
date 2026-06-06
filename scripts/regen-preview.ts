// One-off preview: regenerate a single Korbey page, resolve its stock photos,
// download them locally for visual inspection. Run with:
//   npx tsx scripts/regen-preview.ts <contentJobId> <outlineId>
import { writeFileSync, mkdirSync } from 'fs'
import { generateSinglePage } from '../lib/content/content-generator'
import { extractInlineImageRefs } from '../lib/content/image-ref-extractor'
import { resolveStockPhotos, type ImageRef } from '../lib/content/stock-photo-resolver'
import { deriveImageStyleSuffix } from '../lib/content/visual-style-derivation'
import { createServerClient } from '../lib/supabase/server'
import type { SessionSchema } from '../types/session-schema'
import type { PaletteData } from '../types/palette'

const [jobId, outlineId, skipGen] = process.argv.slice(2)
if (!jobId || !outlineId) throw new Error('usage: regen-preview.ts <jobId> <outlineId> [--skip-gen]')

async function main() {
  const supabase = createServerClient()

  const { data: outline } = await supabase
    .from('page_outlines')
    .select('page_url')
    .eq('id', outlineId)
    .single()
  if (!outline) throw new Error('outline not found')

  if (skipGen !== '--skip-gen') {
    console.log('— regenerating page…')
    const result = await generateSinglePage(jobId, outlineId)
    console.log('generation:', result)
    if (result.status !== 'complete') process.exit(1)
  }

  const { data: page } = await supabase
    .from('generated_pages')
    .select('page_url, content_markdown, hero_image, hero_image_query')
    .eq('content_job_id', jobId)
    .eq('page_url', outline.page_url)
    .single()
  if (!page?.content_markdown) throw new Error('no content after generation')

  console.log('\n— block annotations:')
  for (const line of page.content_markdown.split('\n')) {
    if (line.includes('<!-- block:')) console.log(' ', line.trim())
  }
  console.log('\n— hero:', page.hero_image, '|', page.hero_image_query)
  const iconLines = page.content_markdown.match(/^icon:\s*\w+$/gm) ?? []
  console.log('— icon lines:', iconLines.length, iconLines.join(', '))

  const refs: ImageRef[] = []
  if (page.hero_image && page.hero_image_query) {
    refs.push({ pageUrl: page.page_url, filename: page.hero_image, subjectQuery: page.hero_image_query, source: 'hero' })
  }
  refs.push(...extractInlineImageRefs(page.content_markdown, page.page_url))
  console.log('\n— image refs:', refs.map((r) => `${r.source}:${r.filename} ("${r.subjectQuery}")`).join('\n  '))

  const { data: job } = await supabase.from('content_jobs').select('session_id, palette').eq('id', jobId).single()
  const { data: session } = await supabase.from('sessions').select('schema_data').eq('id', job!.session_id).single()
  const { data: existingAssets } = await supabase.from('assets').select('*').eq('session_id', job!.session_id)
  const schema = (session?.schema_data ?? {}) as SessionSchema
  const styleSuffix = deriveImageStyleSuffix(job!.palette as PaletteData | null, schema.brand)
  console.log('\n— style suffix:', styleSuffix)

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
  console.log('— resolved:', resolved.length)

  mkdirSync('/tmp/korbey-preview', { recursive: true })
  for (const ref of refs) {
    const { data: blob } = await supabase.storage
      .from('session-assets')
      .download(`sessions/${job!.session_id}/${ref.filename}`)
    if (!blob) {
      console.log('  (not in storage):', ref.filename)
      continue
    }
    const out = `/tmp/korbey-preview/${ref.filename}`
    writeFileSync(out, Buffer.from(await blob.arrayBuffer()))
    console.log('  saved:', out)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
