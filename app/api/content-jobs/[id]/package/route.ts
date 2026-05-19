import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { buildAllPageFiles, buildErrorsFile, appendFaqBlock } from '@/lib/content/deliverable-builder'
import type { CtaInfo } from '@/lib/content/deliverable-builder'
import { buildDocx } from '@/lib/content/docx-builder'
import { buildLlmsTxt, buildLlmsFullTxt } from '@/lib/content/llms-builder'
import { buildRobotsTxt } from '@/lib/content/robots-builder'
import { generateBrandDoc } from '@/lib/content/brand-doc-builder'
import { buildSitemapXml } from '@/lib/content/sitemap-xml-builder'
import { buildJsonLdForPage } from '@/lib/content/json-ld-builder'
import { buildRedirectsCsv } from '@/lib/content/redirect-map-builder'
import { assembleZip } from '@/lib/content/zip-assembler'
import { buildDesignMd } from '@/lib/content/design-md-builder'
import { buildBrandJson } from '@/lib/content/brand-json-builder'
import { buildDesignJson } from '@/lib/content/design-json-builder'
import { buildNavJson } from '@/lib/content/nav-json-builder'
import type { SessionSchema } from '@/types/session-schema'
import type { PaletteData } from '@/types/palette'
import type { DesignTokens } from '@/types/design-tokens'

const OG_IMAGES_README = `# OG Images

Each generated page references an Open Graph / social-share image at:

    <site-origin>/og-images/<filename>.png

The filename is derived from the page's URL by stripping the leading slash and
replacing remaining slashes with double-hyphens (the same convention used for
the page markdown filenames in pages/). For example:

    /                                  → og-images/home.png
    /services                          → og-images/services.png
    /services/virtual-cfo-advisory     → og-images/services--virtual-cfo-advisory.png
    /industries/nonprofits             → og-images/industries--nonprofits.png

You can confirm the exact filename for each page in its frontmatter under
\`og_image\`. The package does not generate the actual image files — drop the
PNGs into this folder before deploying so social shares on LinkedIn, Facebook,
X/Twitter, and similar pick up the right image.

Recommended:
- 1200×630 px, < 5 MB
- High-contrast text legible at thumbnail size
- Brand palette colors (see design.md)
`

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
    .select('session_id, confirmed_sitemap, palette, design_tokens, nav_config')
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

  // Approval gate: every successfully-generated page must be admin-approved
  // before we ship the package. Errored pages are exempt — they end up in
  // ERRORS.md regardless.
  const unapprovedComplete = pages
    .filter(p => p.generation_status === 'complete' && !p.admin_approved_content)
    .map(p => ({ id: p.id, page_url: p.page_url, page_title: p.page_title }))
  if (unapprovedComplete.length > 0) {
    return NextResponse.json(
      {
        error: 'Pages awaiting approval',
        unapproved: unapprovedComplete,
      },
      { status: 400 }
    )
  }

  // Client review gate: pages flagged for client review must also have client
  // approval before we ship the package. This check fires only on pages that
  // have already passed the admin-approval gate above.
  const awaitingClient = pages
    .filter(
      p =>
        p.generation_status === 'complete' &&
        p.admin_approved_content &&
        p.needs_client_review &&
        !p.client_approved_content
    )
    .map(p => ({ id: p.id, page_url: p.page_url, page_title: p.page_title }))
  if (awaitingClient.length > 0) {
    return NextResponse.json(
      {
        error: 'Awaiting client approval',
        awaitingClient,
      },
      { status: 400 }
    )
  }

  // Build folder name
  const folderName = firmName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '') + '-content'

  // CTA per page (from the approved outline) — used in deliverable frontmatter.
  const { data: outlineCtas } = await supabase
    .from('page_outlines')
    .select('page_url, cta')
    .eq('content_job_id', id)
  const ctaByUrl = new Map<string, CtaInfo | null>()
  for (const row of outlineCtas ?? []) {
    const cta = row.cta as { text?: unknown; url?: unknown } | null
    if (cta && typeof cta.text === 'string' && typeof cta.url === 'string') {
      ctaByUrl.set(row.page_url, { text: cta.text, url: cta.url })
    }
  }

  // JSON-LD per page — deterministic from schema + sitemap + page metadata.
  const jsonLdByUrl = new Map<string, string>()
  for (const page of pages) {
    if (page.generation_status !== 'complete') continue
    jsonLdByUrl.set(
      page.page_url,
      buildJsonLdForPage({ schema, websiteUrl: session.website_url, page, sitemap })
    )
  }

  // The brand-doc LLM call and the docx render are both async/expensive; run
  // them in parallel with each other (the deterministic stitches that depend
  // on neither stay synchronous and run after).
  const [brandDoc, docxBuffer] = await Promise.all([
    generateBrandDoc(schema),
    buildDocx(pages, firmName),
  ])

  const palette = job.palette as PaletteData | null
  const designTokens = job.design_tokens as DesignTokens | null

  let designMd: string | null = null
  if (palette && designTokens) {
    designMd = buildDesignMd({
      firmName,
      palette,
      tokens: designTokens,
      brand: schema.brand,
      business: schema.business,
      location: schema.locations?.[0]
        ? { city: schema.locations[0].city, state: schema.locations[0].state }
        : null,
    })
  } else {
    console.warn(`[package] Skipping design.md — palette=${!!palette}, design_tokens=${!!designTokens}`)
  }

  // Phase II JSON contract — emitted alongside the existing markdown
  // outputs. Consumed by the client-site template repo.
  const brandJson = palette ? buildBrandJson(schema, palette) : null
  const designJson = designTokens ? buildDesignJson(designTokens) : null
  const navJson = buildNavJson(
    sitemap as Parameters<typeof buildNavJson>[0],
    job.nav_config
  )

  if (!brandJson) console.warn(`[package] Skipping brand.json — palette not locked`)
  if (!designJson) console.warn(`[package] Skipping design.json — design tokens not locked`)

  const pagesWithFaq = pages.map(p => ({ ...p, content_markdown: appendFaqBlock(p) }))

  const pageFiles = buildAllPageFiles(pagesWithFaq, firmName, {
    websiteUrl: session.website_url,
    ctaByUrl,
    jsonLdByUrl,
  })
  const errorsFile = buildErrorsFile(pages)

  const llmsTxt = buildLlmsTxt(firmName, brandDoc.summary, sitemap, pages)
  const llmsFullTxt = buildLlmsFullTxt(firmName, brandDoc.fullDoc, sitemap, pages)
  const robotsTxt = buildRobotsTxt(session.website_url)
  const sitemapXml = buildSitemapXml(session.website_url, sitemap)
  const redirectsCsv = buildRedirectsCsv(schema.current_sitemap)

  // Assemble zip
  const entries = [
    ...pageFiles.map(f => ({ path: `${folderName}/pages/${f.filename}`, content: f.content })),
    { path: `${folderName}/${folderName}.docx`, content: docxBuffer },
    { path: `${folderName}/brand.md`, content: brandDoc.fullDoc },
    ...(designMd ? [{ path: `${folderName}/design.md`, content: designMd }] : []),
    ...(brandJson ? [{ path: `${folderName}/brand.json`, content: JSON.stringify(brandJson, null, 2) }] : []),
    ...(designJson ? [{ path: `${folderName}/design.json`, content: JSON.stringify(designJson, null, 2) }] : []),
    { path: `${folderName}/nav.json`, content: JSON.stringify(navJson, null, 2) },
    { path: `${folderName}/llms.txt`, content: llmsTxt },
    { path: `${folderName}/llms-full.txt`, content: llmsFullTxt },
    { path: `${folderName}/robots.txt`, content: robotsTxt },
    { path: `${folderName}/sitemap.xml`, content: sitemapXml },
    { path: `${folderName}/redirects.csv`, content: redirectsCsv },
    { path: `${folderName}/og-images/README.md`, content: OG_IMAGES_README },
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
