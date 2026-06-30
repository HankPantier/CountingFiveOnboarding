import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { sanitizeSvg } from '@/lib/assets/sanitize-svg'

export const runtime = 'nodejs'
export const maxDuration = 30

const RASTER_MIMES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function safeBaseName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  return base || 'logo'
}

// Upload a client logo for a session and store it as the single `logo` asset
// (replacing any prior one). Raster files are magic-byte validated; SVG is
// sanitized (file-type can't validate it). The palette step re-derives the
// palette from this asset, and packaging later commits it to the client repo.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  const access = await requireSessionAccess(id)
  if (access instanceof NextResponse) return access

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Max 10MB' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const detected = await fileTypeFromBuffer(buffer)

  let storeBuffer: Buffer = buffer
  let mime: string
  let ext: string
  if (detected && RASTER_MIMES.includes(detected.mime)) {
    mime = detected.mime
    ext = detected.ext
  } else if (!detected) {
    // No magic bytes — the only image format we accept here is SVG. Validate by
    // sanitizing: a non-SVG (or script-only) input yields null and is rejected.
    const clean = sanitizeSvg(buffer.toString('utf-8'))
    if (!clean) {
      return NextResponse.json({ error: 'Unsupported file — use PNG, JPG, WebP, or SVG' }, { status: 415 })
    }
    storeBuffer = Buffer.from(clean, 'utf-8')
    mime = 'image/svg+xml'
    ext = 'svg'
  } else {
    return NextResponse.json({ error: 'Unsupported image format — use PNG, JPG, WebP, or SVG' }, { status: 415 })
  }

  const supabase = createServerClient()

  // Replace any existing logo so exactly one `logo` asset exists (avoids
  // palette/packager ambiguity).
  const { data: prior } = await supabase
    .from('assets')
    .select('storage_path')
    .eq('session_id', id)
    .eq('asset_category', 'logo')
  const priorPaths = (prior ?? []).map(p => p.storage_path).filter((p): p is string => !!p)
  if (priorPaths.length > 0) {
    await supabase.storage.from('session-assets').remove(priorPaths)
    await supabase.from('assets').delete().eq('session_id', id).eq('asset_category', 'logo')
  }

  const fileName = `${safeBaseName(file.name)}.${ext}`
  const storagePath = `sessions/${id}/${randomUUID()}-${fileName}`

  const { error: uploadErr } = await supabase.storage
    .from('session-assets')
    .upload(storagePath, storeBuffer, { contentType: mime, upsert: true })
  if (uploadErr) {
    return NextResponse.json({ error: `Storage upload failed: ${uploadErr.message}` }, { status: 500 })
  }

  const { data: asset, error: insertErr } = await supabase
    .from('assets')
    .insert({
      session_id: id,
      file_name: fileName,
      storage_path: storagePath,
      public_url: null,
      mime_type: mime,
      file_size_bytes: storeBuffer.length,
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
