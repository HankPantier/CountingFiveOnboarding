import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { fileTypeFromBuffer } from 'file-type'

export const runtime = 'nodejs'
// Allow up to 25MB photo uploads — Vercel's default body-size cap is 4.5MB
// which is fine for typical stock photos but not generous enough for some
// real headshots. The runtime guard inside handles oversize gracefully.
export const maxDuration = 60

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 25 * 1024 * 1024

/**
 * Replace an existing stock-photo asset's storage object + metadata atomically
 * with an admin-supplied file. The asset ROW stays put (same id, same
 * file_name) so any markdown reference like `image: services-overview.jpg`
 * continues to resolve. The storage object at asset.storage_path is
 * overwritten with the new bytes.
 *
 * Body: multipart/form-data with fields:
 *   - assetId: string — the existing asset to replace
 *   - file: File — the new image bytes
 *
 * Magic-byte validation runs the same way as /api/upload/confirm. On any
 * failure, the existing storage object is left untouched.
 */
export async function POST(req: Request) {
  const form = await req.formData()
  const assetId = form.get('assetId')
  const file = form.get('file')

  if (typeof assetId !== 'string' || !assetId) {
    return NextResponse.json({ error: 'assetId required' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Max 25MB' }, { status: 400 })
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

  const buffer = Buffer.from(await file.arrayBuffer())
  const detected = await fileTypeFromBuffer(buffer)
  if (!detected || !ALLOWED_MIMES.includes(detected.mime)) {
    return NextResponse.json(
      { error: 'File type rejected — content does not match allowed image formats' },
      { status: 400 }
    )
  }

  // Overwrite the storage object in place at the existing path
  const { error: uploadErr } = await supabase.storage
    .from('session-assets')
    .upload(asset.storage_path, buffer, {
      contentType: detected.mime,
      upsert: true,
    })
  if (uploadErr) {
    return NextResponse.json({ error: `Storage upload failed: ${uploadErr.message}` }, { status: 500 })
  }

  // Update the row metadata to reflect the override and current bytes
  const newMetadata = {
    source: 'admin-upload' as const,
    replaced_at: new Date().toISOString(),
    previous_metadata: asset.metadata ?? null,
  }
  const { error: updateErr } = await supabase
    .from('assets')
    .update({
      mime_type: detected.mime,
      file_size_bytes: buffer.length,
      metadata: newMetadata as unknown as never,
    })
    .eq('id', assetId)
  if (updateErr) {
    return NextResponse.json({ error: `Asset update failed: ${updateErr.message}` }, { status: 500 })
  }

  return NextResponse.json({
    assetId,
    mimeType: detected.mime,
    fileSize: buffer.length,
  })
}
