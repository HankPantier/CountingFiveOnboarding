import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { buildBrandJson } from '@/lib/content/brand-json-builder'
import { buildClientCenterJson } from '@/lib/content/client-center-json-builder'
import { buildNavJson, type SitemapEntry } from '@/lib/content/nav-json-builder'
import { buildDiviExport } from '@/lib/content/divi'
import type { SessionSchema } from '@/types/session-schema'
import type { PaletteData } from '@/types/palette'
import type { NavJson } from '@/types/nav-json'
import type { Database } from '@/types/database'

// archiver (zip) + the Node stream pipeline require the Node.js runtime.
export const runtime = 'nodejs'

type GeneratedPageRow = Database['public']['Tables']['generated_pages']['Row']

// Fallback palette (brand navy/cyan) when a job hasn't run the Design System
// step yet — keeps the export usable instead of 500-ing on a null palette.
const FALLBACK_PALETTE: PaletteData = {
  primary: { hex: '#003B71', name: 'Navy' },
  secondary: { hex: '#00C1DE', name: 'Cyan' },
  complementary: { hex: '#00C1DE', name: 'Cyan' },
  action: { hex: '#00C1DE', name: 'Cyan' },
  nearBlack: { hex: '#231F20', name: 'Near Black' },
  nearWhite: { hex: '#F7FAFC', name: 'Near White' },
}

function gmtStamp(d: Date): string {
  // "YYYY-MM-DD HH:mm:ss" in UTC — the format WP/Divi expect for post dates.
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireContentJobAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()

  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id, confirmed_sitemap, palette, nav_config')
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

  const { data: pages } = await supabase
    .from('generated_pages')
    .select('*')
    .eq('content_job_id', id)
    .order('created_at', { ascending: true })

  const completed = (pages ?? []).filter(
    (p: GeneratedPageRow) => p.generation_status === 'complete' && p.content_markdown
  )
  if (completed.length === 0) {
    return NextResponse.json(
      { error: 'No completed pages to export yet — generate content first.' },
      { status: 409 }
    )
  }

  // Logo: signed because the session-assets bucket is private. The URL is
  // embedded in the header layout; it expires (the README tells the operator to
  // re-upload for permanence).
  const { data: logoAsset } = await supabase
    .from('assets')
    .select('storage_path')
    .eq('session_id', job.session_id)
    .eq('asset_category', 'logo')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  let logoUrl: string | null = null
  if (logoAsset?.storage_path) {
    const { data: signed } = await supabase.storage
      .from('session-assets')
      .createSignedUrl(logoAsset.storage_path, 60 * 60 * 24 * 7) // 7 days
    logoUrl = signed?.signedUrl ?? null
  }

  const schema = (session.schema_data ?? {}) as SessionSchema
  const palette = (job.palette as PaletteData | null) ?? FALLBACK_PALETTE
  const sitemap = (job.confirmed_sitemap ?? []) as SitemapEntry[]

  const brand = buildBrandJson(schema, palette)
  const clientCenter = buildClientCenterJson(schema)
  const nav = buildNavJson(sitemap, (job.nav_config as NavJson | null) ?? undefined)
  const firmName = brand.firm.name || session.website_url

  const { zip, filenameBase } = await buildDiviExport({
    firmName,
    websiteUrl: session.website_url,
    pages: completed,
    sitemap,
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
}
