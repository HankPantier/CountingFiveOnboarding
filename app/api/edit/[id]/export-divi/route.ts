import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { createServerClient } from '@/lib/supabase/server'
import { DRAFT_BRANCH, ensureDraftBranch, listTree, readFile } from '@/lib/github/repo-files'
import { parseNavJson } from '@/lib/editor/nav-config'
import { parseClientCenterJson } from '@/lib/editor/client-center-config'
import { buildBrandJson } from '@/lib/content/brand-json-builder'
import { buildClientCenterJson } from '@/lib/content/client-center-json-builder'
import { buildDiviExport, type DiviPageInput } from '@/lib/content/divi'
import { pageInputFromRepoFile } from '@/lib/content/divi/from-frontmatter'
import type { SessionSchema } from '@/types/session-schema'
import type { PaletteData } from '@/types/palette'
import type { NavJson } from '@/types/nav-json'
import type { ClientCenterJson } from '@/types/client-center'

// archiver (zip) + GitHub reads require the Node.js runtime; a large site takes
// a few dozen sequential reads plus Pexels lookups.
export const runtime = 'nodejs'
export const maxDuration = 60

const NAV_PATH = 'content/nav.json'
const CLIENT_CENTER_PATH = 'content/client-center.json'
const READ_CONCURRENCY = 4

// Fallback palette (brand navy/cyan) when a job hasn't run the Design System
// step yet — keeps the export usable instead of failing on a null palette.
const FALLBACK_PALETTE: PaletteData = {
  primary: { hex: '#003B71', name: 'Navy' },
  secondary: { hex: '#00C1DE', name: 'Cyan' },
  complementary: { hex: '#00C1DE', name: 'Cyan' },
  action: { hex: '#00C1DE', name: 'Cyan' },
  nearBlack: { hex: '#231F20', name: 'Near Black' },
  nearWhite: { hex: '#F7FAFC', name: 'Near White' },
}

function gmtStamp(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
}

async function readInBatches(
  repo: string,
  paths: string[]
): Promise<{ path: string; content: string }[]> {
  const out: { path: string; content: string }[] = []
  for (let i = 0; i < paths.length; i += READ_CONCURRENCY) {
    const batch = paths.slice(i, i + READ_CONCURRENCY)
    const read = await Promise.all(
      batch.map(async (path) => ({ path, content: (await readFile(repo, path, DRAFT_BRANCH)).content }))
    )
    out.push(...read)
  }
  return out
}

// Build a flat primary nav from top-level pages when the repo has no nav.json.
function fallbackNav(pages: DiviPageInput[]): NavJson {
  const primary = pages
    .filter((p) => {
      const segs = p.page_url.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
      return segs.length === 1
    })
    .map((p) => ({ label: p.page_title, url: p.page_url }))
  return { primary }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  const supabase = createServerClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('website_url, schema_data')
    .eq('id', ctx.sessionId)
    .single()
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const { data: job } = await supabase
    .from('content_jobs')
    .select('palette')
    .eq('id', ctx.jobId)
    .maybeSingle()

  // Logo: signed because session-assets is private. Embedded in the header
  // layout; long TTL since it can't be refreshed after download (README notes it).
  const { data: logoAsset } = await supabase
    .from('assets')
    .select('storage_path')
    .eq('session_id', ctx.sessionId)
    .eq('asset_category', 'logo')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  let logoUrl: string | null = null
  if (logoAsset?.storage_path) {
    const { data: signed } = await supabase.storage
      .from('session-assets')
      .createSignedUrl(logoAsset.storage_path, 60 * 60 * 24 * 7)
    logoUrl = signed?.signedUrl ?? null
  }

  const schema = (session.schema_data ?? {}) as SessionSchema
  const palette = (job?.palette as PaletteData | null) ?? FALLBACK_PALETTE
  const brand = buildBrandJson(schema, palette)
  const firmName = brand.firm.name || session.website_url

  try {
    await ensureDraftBranch(ctx.githubRepo)
    const tree = await listTree(ctx.githubRepo, DRAFT_BRANCH, 'content/')

    // Pages only — blog posts (content/posts) use the Divi blog template, which
    // is out of scope for this bridge.
    const pagePaths = tree
      .filter((e) => e.type === 'blob' && e.path.startsWith('content/pages/') && e.path.endsWith('.md'))
      .map((e) => e.path)

    if (pagePaths.length === 0) {
      return NextResponse.json({ error: 'No content pages found for this site' }, { status: 404 })
    }

    const files = await readInBatches(ctx.githubRepo, pagePaths)
    const pages: DiviPageInput[] = files.map((f) => pageInputFromRepoFile(f.path, f.content))

    // Nav + Client Center from the live repo, with graceful fallbacks.
    let nav: NavJson = fallbackNav(pages)
    if (tree.some((e) => e.path === NAV_PATH)) {
      try {
        const navBlob = await readFile(ctx.githubRepo, NAV_PATH, DRAFT_BRANCH)
        nav = parseNavJson(navBlob.content) as NavJson
      } catch {
        /* malformed nav — keep the fallback */
      }
    }

    let clientCenter: ClientCenterJson = buildClientCenterJson(schema)
    if (tree.some((e) => e.path === CLIENT_CENTER_PATH)) {
      try {
        const ccBlob = await readFile(ctx.githubRepo, CLIENT_CENTER_PATH, DRAFT_BRANCH)
        clientCenter = parseClientCenterJson(ccBlob.content) as ClientCenterJson
      } catch {
        /* malformed client-center — keep the schema-derived fallback */
      }
    }

    const { zip, filenameBase } = await buildDiviExport({
      firmName,
      websiteUrl: session.website_url,
      pages,
      brand,
      clientCenter,
      nav,
      logoUrl,
      pexelsApiKey: process.env.PEXELS_API_KEY ?? '',
      dateGmt: gmtStamp(new Date()),
    })

    return new Response(new Uint8Array(zip), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filenameBase}-divi-export.zip"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
