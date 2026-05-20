import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { buildAllPageFiles, buildErrorsFile, appendFaqBlock, injectTeamPhotos } from '@/lib/content/deliverable-builder'
import type { CtaInfo } from '@/lib/content/deliverable-builder'
import { buildDocx } from '@/lib/content/docx-builder'
import { buildLlmsTxt, buildLlmsFullTxt } from '@/lib/content/llms-builder'
import { buildRobotsTxt } from '@/lib/content/robots-builder'
import { generateBrandDoc } from '@/lib/content/brand-doc-builder'
import { buildSitemapXml } from '@/lib/content/sitemap-xml-builder'
import { buildJsonLdForPage } from '@/lib/content/json-ld-builder'
import { buildRedirectsCsv } from '@/lib/content/redirect-map-builder'
import type { RedirectIssue } from '@/lib/content/redirect-map-builder'
import { assembleZip } from '@/lib/content/zip-assembler'
import { buildDesignMd } from '@/lib/content/design-md-builder'
import { buildBrandJson } from '@/lib/content/brand-json-builder'
import { buildDesignJson } from '@/lib/content/design-json-builder'
import { buildNavJson } from '@/lib/content/nav-json-builder'
import { generateWordmarkSvg } from '@/lib/content/wordmark-generator'
import { generateInitialsAvatar } from '@/lib/content/initials-avatar-generator'
import { deriveImageStyleSuffix } from '@/lib/content/visual-style-derivation'
import { resolveStockPhotos, buildCreditsMarkdown, type ResolvedStockPhoto } from '@/lib/content/stock-photo-resolver'
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

  // Stock-photo resolution: for any page with a hero_image_query but no
  // matching uploaded asset, fetch from Pexels and persist as a real
  // assets-table row in this session. Brand-aware: deriveImageStyleSuffix
  // computes a visual style suffix from palette + tone adjectives so every
  // photo on the site shares aesthetic. Pulls the existing asset list once
  // to know what's already resolved (deterministic reruns).
  const palettePreResolve = job.palette as PaletteData | null
  const styleSuffix = deriveImageStyleSuffix(palettePreResolve, schema.brand)
  let stockPhotoResolutions: ResolvedStockPhoto[] = []
  const { data: preResolveAssets } = await supabase
    .from('assets')
    .select('*')
    .eq('session_id', job.session_id)
  if (palettePreResolve) {
    stockPhotoResolutions = await resolveStockPhotos(
      {
        sessionId: job.session_id,
        apiKey: process.env.PEXELS_API_KEY ?? '',
        styleSuffix,
        existingAssets: preResolveAssets ?? [],
        pages: pages.map(p => ({
          page_url: p.page_url,
          hero_image: p.hero_image,
          hero_image_query: p.hero_image_query,
        })),
      },
      supabase
    )
    if (stockPhotoResolutions.length > 0) {
      console.log(`[package] Stock photos resolved: ${stockPhotoResolutions.length} (suffix="${styleSuffix}")`)
    }
  }

  // Pull session-uploaded assets from storage — runs AFTER stock photo
  // resolution so newly-inserted stock-photo rows are included.
  const { data: assetRows } = await supabase
    .from('assets')
    .select('id, file_name, storage_path, asset_category, mime_type, metadata')
    .eq('session_id', job.session_id)
    .order('uploaded_at', { ascending: true })

  const sessionAssets = assetRows ?? []

  const assetEntries: Array<{ path: string; content: Buffer; fileName: string; category: string | null }> = []
  const seenFilenames = new Set<string>()

  await Promise.all(sessionAssets.map(async (asset) => {
    const { data, error } = await supabase.storage
      .from('session-assets')
      .download(asset.storage_path)
    if (error || !data) {
      console.warn(`[package] Failed to download asset ${asset.storage_path}: ${error?.message}`)
      return
    }
    const buffer = Buffer.from(await data.arrayBuffer())

    // Use the original file_name. On collision, append a numeric suffix.
    let cleanName = asset.file_name
    let counter = 1
    while (seenFilenames.has(cleanName)) {
      const dotIdx = asset.file_name.lastIndexOf('.')
      const stem = dotIdx > 0 ? asset.file_name.slice(0, dotIdx) : asset.file_name
      const ext = dotIdx > 0 ? asset.file_name.slice(dotIdx) : ''
      cleanName = `${stem}-${counter}${ext}`
      counter++
    }
    seenFilenames.add(cleanName)

    assetEntries.push({
      path: `public/content-assets/${cleanName}`,
      content: buffer,
      fileName: cleanName,
      category: asset.asset_category,
    })
  }))

  console.log(`[package] Bundled ${assetEntries.length} session asset(s) into public/content-assets/`)

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

  // Override logo.primary with the actual uploaded logo asset filename
  if (brandJson) {
    const logoAsset =
      assetEntries.find(a => a.category === 'logo') ??
      assetEntries.find(a => /\blogo\b/i.test(a.fileName))
    if (logoAsset) {
      brandJson.logo = {
        primary: logoAsset.fileName,
        alt: brandJson.logo?.alt || `${brandJson.firm.name} logo`,
      }
    } else if (palette && designJson?.typography?.headingFont) {
      // No uploaded logo — generate a branded SVG wordmark so the NavBar
      // ships with the firm name in the heading font + primary color
      // instead of falling back to plain text. Synthesized at package time
      // (not at zip-receive time) so the file lands inside the deliverable
      // under public/content-assets/ exactly like a user-uploaded logo.
      const wordmark = generateWordmarkSvg({
        firmName: brandJson.firm.name || firmName,
        primaryColor: palette.primary.hex,
        headingFont: designJson.typography.headingFont,
      })
      assetEntries.push({
        path: `public/content-assets/${wordmark.filename}`,
        content: Buffer.from(wordmark.svg, 'utf-8'),
        fileName: wordmark.filename,
        category: 'logo',
      })
      brandJson.logo = {
        primary: wordmark.filename,
        alt: brandJson.logo?.alt || `${brandJson.firm.name} logo`,
      }
      console.log(`[package] No logo upload found — generated wordmark ${wordmark.filename}`)
    }
  }

  // Team-photo binding: assets tagged with metadata.team_member_name are
  // attached to specific team members during Phase 3 chunk 3. Build a map
  // memberName → filename so the team-grid sections in each page can have
  // their `photo:` lines injected. For any team member who didn't get an
  // uploaded headshot, synthesize an initials-avatar SVG and bundle it into
  // the zip alongside the uploads.
  const teamMembers = (schema.team ?? []) as Array<{ name?: string }>
  const photoMap: Record<string, string> = {}
  for (const entry of assetEntries) {
    if (entry.category === 'team-photo') {
      // sessionAssets row that produced this entry — find the original to
      // pull the metadata.team_member_name. assetRows still holds them.
      const sourceRow = (assetRows ?? []).find(r => r.file_name === entry.fileName)
      const memberName = (sourceRow?.metadata as { team_member_name?: string } | null)?.team_member_name
      if (memberName) photoMap[memberName] = entry.fileName
    }
  }
  if (palette && designJson?.typography?.headingFont) {
    for (const member of teamMembers) {
      const name = member?.name?.trim()
      if (!name || photoMap[name]) continue
      const avatar = generateInitialsAvatar({
        memberName: name,
        primaryColor: palette.primary.hex,
        headingFont: designJson.typography.headingFont,
      })
      assetEntries.push({
        path: `public/content-assets/${avatar.filename}`,
        content: Buffer.from(avatar.svg, 'utf-8'),
        fileName: avatar.filename,
        category: 'team-photo',
      })
      photoMap[name] = avatar.filename
    }
    if (teamMembers.length > 0) {
      console.log(`[package] Team photos: ${Object.keys(photoMap).length} bound (${assetEntries.filter(a => a.category === 'team-photo' && a.fileName.endsWith('-avatar.svg')).length} synthesized)`)
    }
  }

  const pagesWithFaq = pages.map(p => ({
    ...p,
    content_markdown: injectTeamPhotos(appendFaqBlock(p), photoMap),
  }))

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
  const redirectsResult = buildRedirectsCsv(
    schema.current_sitemap,
    sitemap as Parameters<typeof buildRedirectsCsv>[1]
  )
  const redirectsCsv = redirectsResult.csv
  const redirectIssues: RedirectIssue[] = redirectsResult.issues

  if (redirectIssues.length > 0) {
    const errors = redirectIssues.filter(i => i.severity === 'error').length
    const warnings = redirectIssues.filter(i => i.severity === 'warning').length
    console.warn(
      `[package] Redirect validation: ${errors} error(s), ${warnings} warning(s)`,
      redirectIssues.map(i => `[${i.severity}] ${i.oldUrl}: ${i.reason}`).join(' | ')
    )
  }

  // Assemble zip
  const entries = [
    // content/ — editable source of truth, read at build time by the Phase II template
    ...pageFiles.map(f => ({ path: `content/pages/${f.filename}`, content: f.content })),
    { path: 'content/brand.md', content: brandDoc.fullDoc },
    ...(designMd ? [{ path: 'content/design.md', content: designMd }] : []),
    ...(brandJson ? [{ path: 'content/brand.json', content: JSON.stringify(brandJson, null, 2) }] : []),
    ...(designJson ? [{ path: 'content/design.json', content: JSON.stringify(designJson, null, 2) }] : []),
    { path: 'content/nav.json', content: JSON.stringify(navJson, null, 2) },
    { path: 'content/redirects.csv', content: redirectsCsv },

    // public/ — served at canonical URLs by Next.js
    { path: 'public/robots.txt', content: robotsTxt },
    { path: 'public/sitemap.xml', content: sitemapXml },
    { path: 'public/llms.txt', content: llmsTxt },
    { path: 'public/llms-full.txt', content: llmsFullTxt },
    { path: 'public/og-images/README.md', content: OG_IMAGES_README },

    // Session-uploaded assets (logos, photos, etc.) — served from public/content-assets/
    ...assetEntries.map(a => ({ path: a.path, content: a.content })),

    // Top-level — human review artifacts
    { path: `${folderName}.docx`, content: docxBuffer },
  ]

  if (errorsFile) {
    entries.push({ path: 'ERRORS.md', content: errorsFile })
  }

  // Pexels attribution. Pexels License doesn't legally require attribution
  // but emitting CREDITS.md insulates against ambiguity if licensing terms
  // change, and gives the client a record of where each photo came from.
  // Includes both freshly-resolved photos and previously-resolved ones
  // already in the assets table (resolver re-surfaces stored metadata).
  if (stockPhotoResolutions.length > 0) {
    entries.push({
      path: 'public/content-assets/CREDITS.md',
      content: buildCreditsMarkdown(stockPhotoResolutions),
    })
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
    assetCount: assetEntries.length,
    sizeKB: Math.round(zipBuffer.length / 1024),
    redirectIssues,
  })
}
