// ---------------------------------------------------------------------------
// Package assembly — the full deliverable build, extracted from the API route
// so it can run from the admin UI (route wraps it with requireAdmin) and from
// operator scripts (scripts/package-job.ts). Pure orchestration over the
// builder libs; all gates and side effects live here.
// ---------------------------------------------------------------------------
import { createServerClient } from '@/lib/supabase/server'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { buildAllPageFiles, buildErrorsFile, appendFaqBlock, injectTeamPhotos, standardizeContactPage } from '@/lib/content/deliverable-builder'
import type { CtaInfo } from '@/lib/content/deliverable-builder'
import { buildDocx } from '@/lib/content/docx-builder'
import { buildPlainText, buildPlainDocx } from '@/lib/content/plain-content-builder'
import { buildLlmsTxt, buildLlmsFullTxt } from '@/lib/content/llms-builder'
import { buildRobotsTxt } from '@/lib/content/robots-builder'
import { generateBrandDoc } from '@/lib/content/brand-doc-builder'
import { validateInternalLinks } from '@/lib/content/link-validator'
import { buildJsonLdForPage } from '@/lib/content/json-ld-builder'
import { buildRedirectsCsv } from '@/lib/content/redirect-map-builder'
import type { RedirectIssue } from '@/lib/content/redirect-map-builder'
import { assembleZip } from '@/lib/content/zip-assembler'
import { resumableUpload, RESUMABLE_THRESHOLD } from '@/lib/supabase/resumable-upload'
import { githubErrorMessage } from '@/lib/github/error-hint'
import {
  DRAFT_BRANCH,
  ensureDraftBranch,
  pushEntriesToBranch,
  patchSiteConfigSiteUrl,
  patchSiteConfigBooking,
  removeStaleStaticSitemap,
} from '@/lib/github/repo-files'
import { getSiteSettings } from '@/lib/content/site-settings'
import { buildDesignMd } from '@/lib/content/design-md-builder'
import { buildBrandJson } from '@/lib/content/brand-json-builder'
import { buildClientCenterJson } from '@/lib/content/client-center-json-builder'
import { applyInkBands, deriveHeroEyebrow, isHomePage } from '@/lib/content/design-variant-injector'
import { buildDesignJson } from '@/lib/content/design-json-builder'
import { FALLBACK_PALETTE, FALLBACK_DESIGN_TOKENS } from '@/lib/content/deliverable-defaults'
import { buildNavJson, normalizeNavUrls } from '@/lib/content/nav-json-builder'
import { DEFAULT_BLOG_CONFIG, serializeBlogConfig } from '@/lib/content/blog-config'
import { getPricingCalculator } from '@/lib/content/pricing-calculator-config'
import {
  buildPricingCalculatorPageMd,
  pricingCalculatorJsonEntry,
  PRICING_CALCULATOR_URL,
  PRICING_CALCULATOR_NAV_LABEL,
} from '@/lib/content/pricing-calculator-json-builder'
import { getPricingPlans } from '@/lib/content/pricing-plans-config'
import {
  buildPricingPlansPageMd,
  pricingPlansJsonEntry,
  PRICING_PLANS_URL,
  PRICING_PLANS_NAV_LABEL,
} from '@/lib/content/pricing-plans-json-builder'
import { buildPlansConfigFromAudit, buildCalculatorConfigFromAudit } from '@/lib/content/pricing-from-audit'
import { siteHost } from '@/lib/content/deliverable-builder'
import { generateWordmarkSvg } from '@/lib/content/wordmark-generator'
import { generateInitialsAvatar } from '@/lib/content/initials-avatar-generator'
import { deriveImageStyleSuffix } from '@/lib/content/visual-style-derivation'
import { resolveStockPhotos, buildCreditsMarkdown, type ResolvedStockPhoto } from '@/lib/content/stock-photo-resolver'
import { collectPageImageRefs, computeImageCoverage } from '@/lib/content/image-coverage'
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

// Everything the git push needs, carried in memory from assembly to the push
// step. `entries` holds file Buffers, so this must NEVER be JSON-serialized
// into an HTTP response — the route strips it before responding and hands it to
// a background after() task.
export type DeployContext = {
  githubRepo: string
  entries: { path: string; content: string | Buffer }[]
  siteUrl: string
  booking: { provider: 'none' | 'calendly' | 'iframe'; url: string }
  author: { authorName: string; authorEmail: string }
}

export type PushOutcome =
  | { ok: true; commitSha: string; fileCount: number }
  | { ok: false; error: string }

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
      // Referenced hero/inline images vs. what actually shipped under
      // public/content-assets/. `missing` non-empty means the site will render
      // "Image not found" on those refs — the operator should Re-pull images.
      imageCoverage: { expected: number; committed: number; missing: string[] }
      // The push is decoupled: assembly returns this context and the caller
      // runs pushAssembledDeliverable() in the background (or awaits it in the
      // CLI). null when no repo is linked. Not part of the JSON response.
      deploy: DeployContext | null
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

  // Nothing-to-ship gate: if not a single page generated successfully (all
  // errored), the package would contain only ERRORS.md and metadata — an empty
  // deliverable that reads as "done". Block it so the operator retries instead.
  const completedPages = pages.filter(p => p.generation_status === 'complete' && p.content_markdown)
  if (completedPages.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'No pages generated successfully — nothing to package. Retry generation before downloading.',
    }
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
  // NOT gated on the palette: a session that packages before its palette is
  // locked still has real hero/inline image refs on every page. The old
  // `if (palette)` gate silently stranded those entire sites with "Image not
  // found" placeholders. deriveImageStyleSuffix already tolerates a null palette
  // (falls back to brand-tone keywords), so resolve whenever there are refs.
  const palettePreResolve = job.palette as PaletteData | null
  const styleSuffix = deriveImageStyleSuffix(palettePreResolve, schema.brand)
  let stockPhotoResolutions: ResolvedStockPhoto[] = []
  const { data: preResolveAssets } = await supabase
    .from('assets')
    .select('*')
    .eq('session_id', job.session_id)

  // Flat list of every image reference across all pages (hero + inline). Kept
  // in scope past resolution so the image-coverage guard below can compare what
  // was referenced against what actually shipped.
  const imageRefs = collectPageImageRefs(pages)

  if (imageRefs.length > 0) {
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

  // Download session assets in bounded batches. A prior unbounded Promise.all
  // over every asset fired hundreds of concurrent storage downloads at once,
  // exhausting the Supabase connection pool ("Too many connections issued to
  // the database") and poisoning the socket state so the final zip upload died
  // with EPIPE — and on Vercel it blew the maxDuration budget. Mirror the
  // chunked pattern in lib/content/link-checker.ts. Naming/collision handling
  // stays sequential in array order so filenames are deterministic across runs.
  const ASSET_DOWNLOAD_CONCURRENCY = 8
  for (let i = 0; i < sessionAssets.length; i += ASSET_DOWNLOAD_CONCURRENCY) {
    const batch = sessionAssets.slice(i, i + ASSET_DOWNLOAD_CONCURRENCY)
    const downloaded = await Promise.all(
      batch.map(async (asset) => {
        const { data, error } = await supabase.storage
          .from('session-assets')
          .download(asset.storage_path)
        if (error || !data) {
          console.warn(`[package] Failed to download asset ${asset.storage_path}: ${error?.message}`)
          return null
        }
        return { asset, buffer: Buffer.from(await data.arrayBuffer()) }
      })
    )

    for (const item of downloaded) {
      if (!item) continue
      const { asset, buffer } = item

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
    }
  }

  console.warn(`[package] Bundled ${assetEntries.length} session asset(s) into public/content-assets/`)

  // The brand-doc LLM call and the docx render are both async/expensive; run
  // them in parallel with each other (the deterministic stitches that depend
  // on neither stay synchronous and run after).
  const [brandDoc, docxBuffer, plainDocxBuffer] = await Promise.all([
    generateBrandDoc(schema, { sessionId: job.session_id, contentJobId: id }),
    buildDocx(pages, firmName),
    buildPlainDocx(pages, firmName),
  ])
  // Styling-free plain-text rendition of the page bodies — pastes cleanly into
  // any CMS/editor without inheriting fonts/colors. Deterministic + cheap.
  const plainTextContent = buildPlainText(pages, firmName)

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

  // Phase II JSON contract — emitted alongside the existing markdown outputs
  // and consumed by the client-site template repo. brand.json + design.json
  // are ALWAYS emitted: the template hard-requires both, so a session that
  // packages before its palette/tokens are locked falls back to a neutral
  // default rather than shipping a zip the template can't validate or theme.
  const brandJson = buildBrandJson(schema, palette ?? FALLBACK_PALETTE)
  const designJson = buildDesignJson(designTokens ?? FALLBACK_DESIGN_TOKENS)
  const navJson = normalizeNavUrls(
    buildNavJson(sitemap as Parameters<typeof buildNavJson>[0], job.nav_config),
    siteHost(session.website_url)
  )

  // Client Center — emitted only when the firm has at least one client portal
  // link. The nav button lives inside the modal component (config-driven), not
  // in nav.json, so there's nothing to append here.
  const clientCenterJson = buildClientCenterJson(schema)

  // Pricing pages — shipped when the operator opted in via the admin editor
  // (explicit enabled row) OR, absent a row, when the onboarding pricing-page
  // preference asked for it. An explicit row always overrides the preference.
  // Each appends a nav entry so the page is reachable.
  const pricingPref = schema.business?.pricingPagePreference
  const prefWantsCalculator = pricingPref === 'calculator' || pricingPref === 'both'
  const prefWantsPlans = pricingPref === 'plans' || pricingPref === 'both'

  // Config to ship when the operator hasn't saved an editor row yet: the base
  // built from pricing the audit captured on the client's current site, falling
  // back to the generic default only when the audit found nothing.
  const pricingCalc = await getPricingCalculator(job.session_id)
  const shipPricingCalculator = pricingCalc.exists ? pricingCalc.enabled : prefWantsCalculator
  const calcConfig = pricingCalc.exists
    ? pricingCalc.config
    : (buildCalculatorConfigFromAudit(schema) ?? pricingCalc.config)
  if (shipPricingCalculator && !navJson.primary.some(item => item.url === PRICING_CALCULATOR_URL)) {
    navJson.primary.push({ label: PRICING_CALCULATOR_NAV_LABEL, url: PRICING_CALCULATOR_URL })
  }

  // Plans page (/pricing). Skip if a generated page already owns /pricing so we
  // never clobber real page content with the config-driven host page.
  const pricingPlans = await getPricingPlans(job.session_id)
  const plansConfig = pricingPlans.exists
    ? pricingPlans.config
    : (buildPlansConfigFromAudit(schema) ?? pricingPlans.config)
  const pricingUrlTaken = pages.some(p => p.page_url === PRICING_PLANS_URL)
  const shipPricingPlans =
    !pricingUrlTaken && (pricingPlans.exists ? pricingPlans.enabled : prefWantsPlans)
  if (pricingUrlTaken && (pricingPlans.exists ? pricingPlans.enabled : prefWantsPlans)) {
    console.warn(`[package] Skipping plans page — a generated page already owns ${PRICING_PLANS_URL}`)
  }
  if (shipPricingPlans && !navJson.primary.some(item => item.url === PRICING_PLANS_URL)) {
    navJson.primary.push({ label: PRICING_PLANS_NAV_LABEL, url: PRICING_PLANS_URL })
  }

  if (!palette) console.warn(`[package] brand.json — palette not locked, using neutral fallback`)
  if (!designTokens) console.warn(`[package] design.json — design tokens not locked, using neutral fallback`)

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

  // Ink & Clay auto-selection: home hero → statement (with a small-caps
  // eyebrow), and industry-cards → the deep "ink" index band, so the deliverable
  // ships in the template's design language rather than a flat default.
  const heroEyebrow = deriveHeroEyebrow({
    city: schema.locations?.[0]?.city,
    state: schema.locations?.[0]?.state,
    foundingYear: schema.business?.foundingYear,
  })
  const pagesWithFaq = pages.map(p => {
    const transformed = {
      ...p,
      content_markdown: injectTeamPhotos(
        standardizeContactPage({
          ...p,
          content_markdown: applyInkBands(appendFaqBlock(p)),
        }),
        photoMap
      ),
    }
    if (isHomePage(p.page_url)) {
      return { ...transformed, hero_block: 'hero', hero_variant: 'statement', hero_eyebrow: heroEyebrow }
    }
    return transformed
  })

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
    { path: 'content/brand.json', content: JSON.stringify(brandJson, null, 2) },
    { path: 'content/design.json', content: JSON.stringify(designJson, null, 2) },
    { path: 'content/nav.json', content: JSON.stringify(navJson, null, 2) },
    // Blog/insights section config — Resources defaults; operators rename the
    // section or change its path via Site settings (see blog-settings route).
    { path: 'content/blog.json', content: serializeBlogConfig(DEFAULT_BLOG_CONFIG) },
    ...(clientCenterJson.enabled
      ? [{ path: 'content/client-center.json', content: JSON.stringify(clientCenterJson, null, 2) }]
      : []),
    ...(shipPricingCalculator
      ? [
          pricingCalculatorJsonEntry(calcConfig),
          {
            path: 'content/pages/pricing-calculator.md',
            content: buildPricingCalculatorPageMd(firmName, calcConfig),
          },
        ]
      : []),
    ...(shipPricingPlans
      ? [
          pricingPlansJsonEntry(plansConfig),
          {
            path: 'content/pages/pricing.md',
            content: buildPricingPlansPageMd(firmName, plansConfig),
          },
        ]
      : []),
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

    // Top-level — human review artifacts. The -plain.* pair is styling-free
    // content for cut-and-paste; kept top-level so the deploy filter (content/
    // + public/ only) excludes them from the repo push.
    { path: `${folderName}.docx`, content: docxBuffer },
    { path: `${folderName}-plain.txt`, content: plainTextContent },
    { path: `${folderName}-plain.docx`, content: plainDocxBuffer },
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

  // Upload to Supabase Storage. The standard upload path rejects large request
  // bodies (an image-heavy ~45MB package dies with EPIPE) well under the
  // bucket's 300MB limit, so anything at/above the resumable threshold goes
  // through the TUS resumable uploader instead of a single POST.
  const storagePath = `content-packages/${job.session_id}/content-package.zip`
  try {
    if (zipBuffer.length >= RESUMABLE_THRESHOLD) {
      await resumableUpload({
        bucket: 'session-assets',
        path: storagePath,
        body: zipBuffer,
        contentType: 'application/zip',
        upsert: true,
      })
    } else {
      const { error: uploadError } = await supabase.storage
        .from('session-assets')
        .upload(storagePath, zipBuffer, { contentType: 'application/zip', upsert: true })
      if (uploadError) throw uploadError
    }
  } catch (uploadError) {
    console.error('[package] Upload failed:', uploadError)
    return {
      ok: false,
      status: 500,
      error: `Failed to upload package: ${uploadError instanceof Error ? uploadError.message : 'unknown error'}`,
    }
  }

  // Upload the styling-free renditions as their own objects so the dedicated
  // download buttons can re-fetch them without re-assembling the package. Small
  // files — the standard upload path is always fine (no TUS threshold needed).
  const plainTxtPath = `content-packages/${job.session_id}/content-plain.txt`
  const plainDocxPath = `content-packages/${job.session_id}/content-plain.docx`
  const [{ error: txtUploadError }, { error: docxUploadError }] = await Promise.all([
    supabase.storage
      .from('session-assets')
      .upload(plainTxtPath, Buffer.from(plainTextContent, 'utf-8'), {
        contentType: 'text/plain; charset=utf-8',
        upsert: true,
      }),
    supabase.storage
      .from('session-assets')
      .upload(plainDocxPath, plainDocxBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      }),
  ])
  if (txtUploadError || docxUploadError) {
    console.error('[package] Plain-content upload failed:', txtUploadError ?? docxUploadError)
    return {
      ok: false,
      status: 500,
      error: `Failed to upload plain content: ${(txtUploadError ?? docxUploadError)?.message ?? 'unknown error'}`,
    }
  }

  // Update job
  await supabase
    .from('content_jobs')
    .update({ phase: 6, updated_at: new Date().toISOString() })
    .eq('id', id)

  console.warn(`[content-job] Package assembled: ${storagePath} (${(zipBuffer.length / 1024).toFixed(0)} KB)`)

  // The push to the linked repo is decoupled from assembly: it's the slow,
  // rate-limit-prone part (hundreds of blobs) and must not block the zip/
  // download or risk the route's timeout. Build the context here; the caller
  // runs pushAssembledDeliverable() in a background after() task (or awaits it
  // in the CLI). Only content/ + public/ files ship to the repo — the .docx +
  // ERRORS.md review artifacts stay out.
  let deploy: DeployContext | null = null
  if (job.github_repo) {
    const siteSettings = await getSiteSettings(job.session_id)
    deploy = {
      githubRepo: job.github_repo,
      entries: entries.filter(
        (e) => e.path.startsWith('content/') || e.path.startsWith('public/')
      ),
      siteUrl: session.website_url.replace(/\/$/, '').replace(/^(?!https?:\/\/)/, 'https://'),
      booking: { provider: siteSettings.bookingProvider, url: siteSettings.bookingUrl },
      author: { authorName: actor.name, authorEmail: actor.email ?? DEFAULT_COMMIT_AUTHOR.email },
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

  // Image-coverage guard: every hero/inline image ref should have a real file
  // bundled under public/content-assets/. When resolution silently returns
  // fewer (missing PEXELS_API_KEY, Pexels outage, rate-limit) the page text
  // still ships but the template renders "Image not found". Surface the
  // shortfall loudly so a broken-image site never publishes unnoticed — the
  // operator can then hit "Re-pull all images".
  const imageCoverage = computeImageCoverage(imageRefs, assetEntries.map(a => a.fileName))
  if (imageCoverage.missing.length > 0) {
    console.error(
      `[package] IMAGE COVERAGE SHORTFALL: ${imageCoverage.missing.length}/${imageCoverage.expected} referenced image(s) not bundled — ${imageCoverage.missing.join(', ')}`
    )
  }

  return {
    ok: true,
    storagePath,
    pageCount: pageFiles.length,
    assetCount: assetEntries.length,
    sizeKB: Math.round(zipBuffer.length / 1024),
    redirectIssues,
    linkWarnings,
    imageCoverage,
    deploy,
  }
}

// Push an assembled deliverable's content/ + public/ files to the linked repo's
// draft branch. Decoupled from assembly so it can run in a background after()
// task (route) or be awaited (CLI). Self-contained and non-throwing: returns a
// PushOutcome rather than throwing, since a GitHub hiccup must never surface as
// an assembly failure.
export async function pushAssembledDeliverable(deploy: DeployContext): Promise<PushOutcome> {
  const { githubRepo, entries, siteUrl, booking, author } = deploy
  try {
    await ensureDraftBranch(githubRepo)
    const pushed = await pushEntriesToBranch(
      githubRepo,
      DRAFT_BRANCH,
      entries,
      `Deploy packaged content via admin${author.authorEmail ? ` (${author.authorEmail})` : ''}`,
      author
    )
    console.warn(
      `[content-job] Pushed ${pushed.fileCount} file(s) to ${githubRepo}@${DRAFT_BRANCH} (${pushed.commitSha.slice(0, 7)})`
    )
    // Point the dynamic sitemap (and other siteConfig consumers) at the
    // canonical host, and drop any stale static sitemap a prior package left
    // behind. Both non-fatal.
    try {
      await patchSiteConfigSiteUrl(githubRepo, DRAFT_BRANCH, siteUrl, author)
    } catch (err) {
      console.warn(`[content-job] site.config siteUrl patch failed for ${githubRepo}:`, err)
    }
    try {
      await patchSiteConfigBooking(githubRepo, DRAFT_BRANCH, booking, author)
    } catch (err) {
      console.warn(`[content-job] site.config booking patch failed for ${githubRepo}:`, err)
    }
    try {
      await removeStaleStaticSitemap(githubRepo, DRAFT_BRANCH, author)
    } catch (err) {
      console.warn(`[content-job] Stale sitemap cleanup failed for ${githubRepo}:`, err)
    }
    return { ok: true, commitSha: pushed.commitSha, fileCount: pushed.fileCount }
  } catch (err) {
    const error = githubErrorMessage(err, githubRepo)
    console.error(`[content-job] Push to ${githubRepo} failed:`, error)
    return { ok: false, error }
  }
}
