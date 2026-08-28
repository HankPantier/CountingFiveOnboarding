import { NextResponse } from 'next/server'
import { fileTypeFromBuffer } from 'file-type'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'

export const runtime = 'nodejs'
export const maxDuration = 30

const RASTER_MIMES = ['image/png', 'image/jpeg', 'image/webp']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Confirm step for a client logo that was uploaded DIRECTLY to Supabase Storage
// via a presigned URL (so it bypasses Vercel's 4.5MB function-body cap). Given
// the storage path, validate the bytes server-side — raster by magic bytes, SVG
// by sanitizing — store it as the single `logo` asset (replacing any prior one),
// and return a signed preview URL. The palette step re-derives from this asset;
// packaging later commits it to the client repo.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  const access = await requireSessionAccess(id)
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => null) as { storagePath?: unknown; fileName?: unknown } | null
  const storagePath = body?.storagePath
  const fileName = typeof body?.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : 'logo'
  // Bind the path to this session — never let a request claim another's file.
  // Decode before the prefix check (security rule 8): a percent-encoded
  // traversal like sessions/{id}/..%2F..%2Fsessions/{other}/logo.png passes a
  // raw startsWith but escapes the prefix once Supabase Storage decodes it.
  if (typeof storagePath !== 'string') {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
  }
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(storagePath)
  } catch {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
  }
  if (
    decodedPath !== storagePath ||
    !decodedPath.startsWith(`sessions/${id}/`) ||
    decodedPath.split('/').some(s => s === '' || s === '.' || s === '..')
  ) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: fileData, error: downloadError } = await supabase.storage
    .from('session-assets')
    .download(storagePath)
  if (downloadError || !fileData) {
    return NextResponse.json({ error: 'Uploaded file not found in storage' }, { status: 400 })
  }

  const buffer = Buffer.from(await fileData.arrayBuffer())
  const detected = await fileTypeFromBuffer(buffer)

  let mime: string
  if (detected && RASTER_MIMES.includes(detected.mime)) {
    mime = detected.mime
  } else if (!detected) {
    // No magic bytes — only SVG is accepted, and only after sanitization. The
    // sanitizer (jsdom-backed) is imported lazily so raster uploads never load it.
    const { sanitizeSvg } = await import('@/lib/assets/sanitize-svg')
    const clean = sanitizeSvg(buffer.toString('utf-8'))
    if (!clean) {
      await supabase.storage.from('session-assets').remove([storagePath])
      return NextResponse.json({ error: 'Unsupported file — use PNG, JPG, WebP, or SVG' }, { status: 415 })
    }
    const { error: reuploadError } = await supabase.storage
      .from('session-assets')
      .upload(storagePath, Buffer.from(clean, 'utf-8'), { contentType: 'image/svg+xml', upsert: true })
    if (reuploadError) {
      return NextResponse.json({ error: 'Failed to store sanitized logo' }, { status: 500 })
    }
    mime = 'image/svg+xml'
  } else {
    await supabase.storage.from('session-assets').remove([storagePath])
    return NextResponse.json({ error: 'Unsupported image format — use PNG, JPG, WebP, or SVG' }, { status: 415 })
  }

  // Replace any existing logo so exactly one `logo` asset exists (don't touch
  // the file we just uploaded).
  const { data: prior } = await supabase
    .from('assets')
    .select('storage_path')
    .eq('session_id', id)
    .eq('asset_category', 'logo')
  const priorPaths = (prior ?? [])
    .map(p => p.storage_path)
    .filter((p): p is string => !!p && p !== storagePath)
  if (priorPaths.length > 0) {
    await supabase.storage.from('session-assets').remove(priorPaths)
  }
  await supabase.from('assets').delete().eq('session_id', id).eq('asset_category', 'logo')

  const { data: asset, error: insertErr } = await supabase
    .from('assets')
    .insert({
      session_id: id,
      file_name: fileName,
      storage_path: storagePath,
      public_url: null,
      mime_type: mime,
      file_size_bytes: buffer.length,
      asset_category: 'logo',
    })
    .select('id')
    .single()
  if (insertErr) {
    return NextResponse.json({ error: 'Failed to record logo asset' }, { status: 500 })
  }

  const { data: signed } = await supabase.storage
    .from('session-assets')
    .createSignedUrl(storagePath, 3600)

  return NextResponse.json({ assetId: asset.id, logoUrl: signed?.signedUrl ?? null })
}
