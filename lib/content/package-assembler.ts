// ---------------------------------------------------------------------------
// Package assembly — the full deliverable build, extracted from the API route
// so it can run from the admin UI (route wraps it with requireAdmin) and from
// operator scripts (scripts/package-job.ts). Pure orchestration over the
// builder libs; all gates and side effects live here.
// ---------------------------------------------------------------------------
import { createServerClient } from '@/lib/supabase/server'
import { buildAllPageFiles, buildErrorsFile, appendFaqBlock, injectTeamPhotos, standardizeContactPage } from '@/lib/content/deliverable-builder'
import type { CtaInfo } from '@/lib/content/deliverable-builder'
import { buildDocx } from '@/lib/content/docx-builder'
import { buildLlmsTxt, buildLlmsFullTxt } from '@/lib/content/llms-builder'
import { buildRobotsTxt } from '@/lib/content/robots-builder'
import { generateBrandDoc } from '@/lib/content/brand-doc-builder'
import { validateInternalLinks } from '@/lib/content/link-validator'
import { buildJsonLdForPage } from '@/lib/content/json-ld-builder'
import { buildRedirectsCsv } from '@/lib/content/redirect-map-builder'
import type { RedirectIssue } from '@/lib/content/redirect-map-builder'
import { assembleZip } from '@/lib/content/zip-assembler'
import {
  DRAFT_BRANCH,
  ensureDraftBranch,
  pushEntriesToBranch,
  patchSiteConfigSiteUrl,
  removeStaleStaticSitemap,
} from '@/lib/github/repo-files'
import { buildDesignMd } from '@/lib/content/design-md-builder'
import { buildBrandJson } from '@/lib/content/brand-json-builder'
import { buildDesignJson } from '@/lib/content/design-json-builder'
import { buildNavJson } from '@/lib/content/nav-json-builder'
import { generateWordmarkSvg } from '@/lib/content/wordmark-generator'
import { generateInitialsAvatar } from '@/lib/content/initials-avatar-generator'
import { deriveImageStyleSuffix } from '@/lib/content/visual-style-derivation'
import { resolveStockPhotos, buildCreditsMarkdown, type ResolvedStockPhoto, type ImageRef } from '@/lib/content/stock-photo-resolver'
import { extractInlineImageRefs } from '@/lib/content/image-ref-extractor'
import type { SessionSchema } from '@/types/session-schema'
import type { PaletteData } from '@/types/palette'
import type { DesignTokens } from '@/types/design-tokens'

const OG_IMAGES_README = `# OG Images

Nothing to do here. The site template generates branded Open Graph /
social-share cards dynamically at:

    <site-origin>/api/og/<page-path>

(e.g. /api/og/services/virtual-cfo-advisory) — built per page from the
frontmatter title/description and brand palette. No static PNGs are required;
the \`og_image\` frontmatter field points at this route.

This folder exists only as a place to drop custom static cards if a client
ever wants hand-designed ones — that would also require pointing the page
metadata at them in the template (src/components/assembly/
GeneratedMarkdownPage.tsx), which currently always uses /api/og.
`

type PageRef = { id: string; page_url: string; page_title: string }

export type PackageResult =
  | { ok: false; status: 400 | 404 | 500; error: string; unapproved?: PageRef[]; awaitingClient?: PageRef[] }
  | {
      ok: true
      storagePath: string
      pageCount: number
      assetCount: number
      sizeKB: number
      redirectIssues: RedirectIssue[]
      linkWarnings: string[]
      pushedToRepo: { commitSha: string; fileCount: number } | null
      pushError: string | null
    }

export async function assembleContentPackage(
  contentJobId: string,
  actor: { name: string; email: string | null }
): Promise<PackageResult> {
  const id = contentJobId
  const supabase = createServerClient()

  // Load job + session
  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id, confirmed_sitemap, palette, design_tokens, nav_config, github_repo')
    .eq('id', id)
    .single()

  if (!job) {
    return { ok: false, status: 404, error: 'Content job not found' }
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('website_url, schema_data')
    .eq('id', job.session_id)
    .single()

  if (!session) {
    return { ok: false, status: 404, error: 'Session not found' }
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
    return { ok: false, status: 404, error: 'No generated pages found' }
  }

  // Approval gate: every successfully-generated page must be admin-approved
  // before we ship the package. Errored pages are exempt — they end up in
  // ERRORS.md regardless.
  const unapprovedComplete = pages
    .filter(p => p.generation_status === 'complete' && !p.admin_approved_content)
    .map(p => ({ id: p.id, page_url: p.page_url, page_title: p.page_title }))
  if (unapprovedComplete.length > 0) {
    return { ok: false, status: 400, error: 'Pages awaiting approval', unapproved: unapprovedComplete }
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
    return { ok: false, status: 400, error: 'Awaiting client approval', awaitingClient }
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
    // Build a flat list of every image reference across all pages:
    //   - hero images (from generated_pages columns)
    //   - annotation images: content-split, image-bg cta-banner,
    //     with-image checklist-section (inline in content_markdown)
    //   - content-cards per-card photo references (inline)
    const imageRefs: ImageRef[] = []
    for (const p of pages) {
      if (p.hero_image && p.hero_image_query) {
        imageRefs.push({
          pageUrl: p.page_url,
          filename: p.hero_image,
          subjectQuery: p.hero_image_query,
          source: 'hero',
        })
      }
      const inline = extractInlineImageRefs(p.content_markdown ?? '', p.page_url)
      imageRefs.push(...inline)
    }

    stockPhotoResolutions = await resolveStockPhotos(
      {
        sessionId: job.session_id,
        apiKey: process.env.PEXELS_API_KEY ?? '',
        styleSuffix,
        existingAssets: preResolveAssets ?? [],
        imageRefs,
      },
      supabase
    )
    if (stockPhotoResolutions.length > 0) {
      console.warn(`[package] Stock photos resolved: ${stockPhotoResolutions.length} (suffix="${styleSuffix}")`)
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

  console.warn(`[package] Bundled ${assetEntries.length} session asset(s) into public/content-assets/`)

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
      console.warn(`[package] No logo upload found — generated wordmark ${wordmark.filename}`)
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
      console.warn(`[package] Team photos: ${Object.keys(photoMap).length} bound (${assetEntries.filter(a => a.category === 'team-photo' && a.fileName.endsWith('-avatar.svg')).length} synthesized)`)
    }
  }

  const pagesWithFaq = pages.map(p => ({
    ...p,
    content_markdown: injectTeamPhotos(
      standardizeContactPage({
        ...p,
        content_markdown: appendFaqBlock(p),
      }),
      photoMap
    ),
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

    // public/ — served at canonical URLs by Next.js. No static sitemap.xml:
    // the template's dynamic src/app/sitemap.ts owns it and auto-includes
    // every post, so a frozen static copy would only shadow + staleness it.
    { path: 'public/robots.txt', content: robotsTxt },
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
    return { ok: false, status: 500, error: 'Failed to upload package' }
  }

  // Update job
  await supabase
    .from('content_jobs')
    .update({ phase: 6, updated_at: new Date().toISOString() })
    .eq('id', id)

  console.warn(`[content-job] Package assembled: ${storagePath} (${(zipBuffer.length / 1024).toFixed(0)} KB)`)

  // Auto-deploy to the linked repo's draft branch so the in-admin editor and
  // Vercel preview reflect the freshly-packaged content. Only content/ and
  // public/ files are pushed (the .docx + ERRORS.md review artifacts stay out
  // of the site repo). Non-fatal: a GitHub hiccup must not fail packaging.
  let pushedToRepo: { commitSha: string; fileCount: number } | null = null
  let pushError: string | null = null
  if (job.github_repo) {
    const repoEntries = entries.filter(
      (e) => e.path.startsWith('content/') || e.path.startsWith('public/')
    )
    try {
      await ensureDraftBranch(job.github_repo)
      pushedToRepo = await pushEntriesToBranch(
        job.github_repo,
        DRAFT_BRANCH,
        repoEntries,
        `Deploy packaged content via admin${actor.email ? ` (${actor.email})` : ''}`,
        { authorName: actor.name, authorEmail: actor.email ?? 'admin@countingfive.com' }
      )
      console.warn(
        `[content-job] Pushed ${pushedToRepo.fileCount} file(s) to ${job.github_repo}@${DRAFT_BRANCH} (${pushedToRepo.commitSha.slice(0, 7)})`
      )
      // Point the dynamic sitemap (and other siteConfig consumers) at the
      // canonical host the content already uses, and drop any stale static
      // sitemap a prior package left behind. Both non-fatal.
      const siteUrl = session.website_url.replace(/\/$/, '').replace(/^(?!https?:\/\/)/, 'https://')
      const author = { authorName: actor.name, authorEmail: actor.email ?? 'admin@countingfive.com' }
      try {
        await patchSiteConfigSiteUrl(job.github_repo, DRAFT_BRANCH, siteUrl, author)
      } catch (err) {
        console.warn(`[content-job] site.config siteUrl patch failed for ${job.github_repo}:`, err)
      }
      try {
        await removeStaleStaticSitemap(job.github_repo, DRAFT_BRANCH, author)
      } catch (err) {
        console.warn(`[content-job] Stale sitemap cleanup failed for ${job.github_repo}:`, err)
      }
    } catch (err) {
      pushError = err instanceof Error ? err.message : 'Push to repo failed'
      console.error(`[content-job] Push to ${job.github_repo} failed:`, pushError)
    }
  }

  // Warn-only quality gate: internal links pointing outside the confirmed
  // sitemap (typos, renamed slugs, hallucinated paths).
  const linkWarnings = validateInternalLinks(
    pages.filter(p => p.generation_status === 'complete'),
    sitemap.map(s => s.url)
  )
  if (linkWarnings.length > 0) {
    console.warn(`[package] ${linkWarnings.length} internal-link warning(s):`, linkWarnings.join(' | '))
  }

  return {
    ok: true,
    storagePath,
    pageCount: pageFiles.length,
    assetCount: assetEntries.length,
    sizeKB: Math.round(zipBuffer.length / 1024),
    redirectIssues,
    linkWarnings,
    pushedToRepo,
    pushError,
  }
}
