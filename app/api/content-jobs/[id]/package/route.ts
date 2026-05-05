import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { buildAllPageFiles, buildErrorsFile } from '@/lib/content/deliverable-builder'
import { buildDocx } from '@/lib/content/docx-builder'
import { buildLlmsTxt, buildLlmsFullTxt } from '@/lib/content/llms-builder'
import { buildRobotsTxt } from '@/lib/content/robots-builder'
import { assembleZip } from '@/lib/content/zip-assembler'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = createServerClient()

  // Load job + session
  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id, confirmed_sitemap')
    .eq('id', id)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('website_url, schema_data')
    .eq('id', job.session_id)
    .single()

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const schema = (session.schema_data ?? {}) as SessionSchema
  const firmName = schema.business?.name ?? 'Unknown Firm'
  const sitemap = (job.confirmed_sitemap as Array<{ url: string; title: string; parent?: string; status: string }>) ?? []

  // Load generated pages
  const { data: pages } = await supabase
    .from('generated_pages')
    .select('*')
    .eq('content_job_id', id)
    .order('created_at', { ascending: true })

  if (!pages?.length) {
    return NextResponse.json({ error: 'No generated pages found' }, { status: 404 })
  }

  // Build folder name
  const folderName = firmName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '') + '-content'

  // Build all deliverables
  const pageFiles = buildAllPageFiles(pages, firmName)
  const errorsFile = buildErrorsFile(pages)

  const firmDesc = schema.business?.tagline
    ? `${firmName}. ${schema.business.tagline}`
    : firmName
  const location = schema.locations?.[0]
    ? `${schema.locations[0].city}, ${schema.locations[0].state}`
    : ''
  const fullDesc = location ? `${firmDesc} Located in ${location}.` : firmDesc

  const llmsTxt = buildLlmsTxt(firmName, fullDesc, sitemap, pages)
  const llmsFullTxt = buildLlmsFullTxt(firmName, fullDesc, sitemap, pages)
  const robotsTxt = buildRobotsTxt(session.website_url)
  const docxBuffer = await buildDocx(pages, firmName)

  // Assemble zip
  const entries = [
    ...pageFiles.map(f => ({ path: `${folderName}/pages/${f.filename}`, content: f.content })),
    { path: `${folderName}/${folderName}.docx`, content: docxBuffer },
    { path: `${folderName}/llms.txt`, content: llmsTxt },
    { path: `${folderName}/llms-full.txt`, content: llmsFullTxt },
    { path: `${folderName}/robots.txt`, content: robotsTxt },
  ]

  if (errorsFile) {
    entries.push({ path: `${folderName}/ERRORS.md`, content: errorsFile })
  }

  const zipBuffer = await assembleZip(entries)

  // Upload to Supabase Storage
  const storagePath = `content-packages/${job.session_id}/content-package.zip`
  const { error: uploadError } = await supabase.storage
    .from('session-assets')
    .upload(storagePath, zipBuffer, {
      contentType: 'application/zip',
      upsert: true,
    })

  if (uploadError) {
    console.error('[package] Upload failed:', uploadError)
    return NextResponse.json({ error: 'Failed to upload package' }, { status: 500 })
  }

  // Update job
  await supabase
    .from('content_jobs')
    .update({ phase: 6, updated_at: new Date().toISOString() })
    .eq('id', id)

  console.log(`[content-job] Package assembled: ${storagePath} (${(zipBuffer.length / 1024).toFixed(0)} KB)`)

  return NextResponse.json({
    success: true,
    storagePath,
    pageCount: pageFiles.length,
    sizeKB: Math.round(zipBuffer.length / 1024),
  })
}
