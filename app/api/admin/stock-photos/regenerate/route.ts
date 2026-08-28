import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { readJsonBody } from '@/app/api/_json'
import { searchPexels, downloadPexelsImage } from '@/lib/content/pexels-fetcher'
import { deriveImageStyleSuffix } from '@/lib/content/visual-style-derivation'
import type { SessionSchema } from '@/types/session-schema'
import type { PaletteData } from '@/types/palette'

export const runtime = 'nodejs'

/**
 * Regenerate a stock-photo asset for a session.
 *
 * Body: { assetId: string, query?: string }
 *
 * - Loads the asset (must be category=stock-photo).
 * - Re-derives the visual-style suffix from the most recent content_job's
 *   palette + the session's brand tone (same logic the package builder runs).
 * - If `query` was provided, use that subject. Otherwise reuse the existing
 *   metadata.original_query so "regenerate" without a query just rerolls
 *   the same query (Pexels' top result can change subtly over time, but
 *   we still typically get the SAME image because of the per_page=1 +
 *   landscape constraint — true variety waits for the dedup-across-pages
 *   commit).
 * - Fetches a new Pexels photo, downloads bytes, replaces the storage
 *   object (upsert), updates the asset row's metadata + file_size_bytes
 *   in place. Filename stays the same so any markdown reference still
 *   resolves.
 *
 * Returns the updated asset summary.
 */
export async function POST(req: Request) {
  const body = await readJsonBody<{ assetId?: string; query?: string }>(req)
  if (body instanceof NextResponse) return body
  const { assetId, query } = body
  if (!assetId || typeof assetId !== 'string') {
    return NextResponse.json({ error: 'assetId required' }, { status: 400 })
  }

  const apiKey = process.env.PEXELS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'PEXELS_API_KEY not configured on server' }, { status: 503 })
  }

  const supabase = createServerClient()

  const { data: asset, error: assetErr } = await supabase
    .from('assets')
    .select('*')
    .eq('id', assetId)
    .single()
  if (assetErr || !asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }

  const access = await requireSessionAccess(asset.session_id)
  if (access instanceof NextResponse) return access

  if (asset.asset_category !== 'stock-photo') {
    return NextResponse.json({ error: 'Asset is not a stock-photo' }, { status: 400 })
  }

  const existingMeta = (asset.metadata as { original_query?: string } | null) ?? {}
  const subjectQuery = (query ?? existingMeta.original_query ?? '').trim()
  if (!subjectQuery) {
    return NextResponse.json({ error: 'No query available (none stored, none provided)' }, { status: 400 })
  }

  // Pull the most recent content_job for this session so we can derive the
  // style suffix from the same palette + brand tone as the original fetch.
  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', asset.session_id)
    .single()
  const { data: job } = await supabase
    .from('content_jobs')
    .select('palette')
    .eq('session_id', asset.session_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const schema = (session?.schema_data ?? {}) as SessionSchema
  const palette = (job?.palette ?? null) as PaletteData | null
  const styleSuffix = deriveImageStyleSuffix(palette, schema.brand)
  const finalQuery = styleSuffix ? `${subjectQuery}, ${styleSuffix}` : subjectQuery

  const photo = await searchPexels(finalQuery, apiKey)
  if (!photo) {
    return NextResponse.json({ error: `Pexels returned no result for "${finalQuery}"` }, { status: 502 })
  }
  const bytes = await downloadPexelsImage(photo.src_large)
  if (!bytes) {
    return NextResponse.json({ error: 'Failed to download new image bytes' }, { status: 502 })
  }

  // Replace storage object in place
  const { error: uploadErr } = await supabase.storage
    .from('session-assets')
    .upload(asset.storage_path, bytes, { contentType: 'image/jpeg', upsert: true })
  if (uploadErr) {
    return NextResponse.json({ error: `Storage upload failed: ${uploadErr.message}` }, { status: 500 })
  }

  // Update assets row metadata
  const newMetadata = {
    source: 'pexels' as const,
    pexels_id: photo.id,
    photographer: photo.photographer,
    photographer_url: photo.photographer_url,
    pexels_url: photo.pexels_url,
    original_query: subjectQuery,
    final_query: finalQuery,
    avg_color: photo.avg_color,
  }
  const { error: updateErr } = await supabase
    .from('assets')
    .update({
      metadata: newMetadata,
      file_size_bytes: bytes.length,
    })
    .eq('id', assetId)
  if (updateErr) {
    return NextResponse.json({ error: `Asset update failed: ${updateErr.message}` }, { status: 500 })
  }

  return NextResponse.json({
    assetId,
    metadata: newMetadata,
    fileSize: bytes.length,
  })
}
