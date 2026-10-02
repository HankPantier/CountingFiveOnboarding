import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireOnboardingSessionAccess } from '@/lib/auth/access'
import { validateLogoUpload } from '@/lib/assets/logo-upload'
import { replaceSessionLogoRow } from '@/lib/assets/replace-session-logo'

export const runtime = 'nodejs'
export const maxDuration = 30

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

  const access = await requireOnboardingSessionAccess(id)
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => null) as { storagePath?: unknown; fileName?: unknown } | null
  const storagePath = body?.storagePath
  // Display name only, but it later becomes a repo file name at packaging —
  // strip path separators / traversal so it can never be read as a path.
  const rawName = typeof body?.fileName === 'string' ? body.fileName : ''
  const fileName = rawName.replace(/[\\/]/g, '_').replace(/\.{2,}/g, '.').replace(/[\x00-\x1f]/g, '').trim().slice(0, 200) || 'logo'
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

  // Only a freshly uploaded object may be confirmed. A path that already backs
  // an `assets` row (a client upload, team photo, or the current logo) is
  // refused — otherwise a failed validation below would DELETE that file, and a
  // sanitized-SVG re-upload would overwrite it.
  const { data: existingAsset, error: existingErr } = await supabase
    .from('assets')
    .select('id')
    .eq('storage_path', storagePath)
    .limit(1)
    .maybeSingle()
  if (existingErr) {
    console.error('[logo] existing-asset check failed:', existingErr)
    return NextResponse.json({ error: 'Could not verify upload' }, { status: 500 })
  }
  if (existingAsset) {
    return NextResponse.json({ error: 'That file is already in use — upload the logo again' }, { status: 409 })
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from('session-assets')
    .download(storagePath)
  if (downloadError || !fileData) {
    return NextResponse.json({ error: 'Uploaded file not found in storage' }, { status: 400 })
  }

  const buffer = Buffer.from(await fileData.arrayBuffer())
  const checked = await validateLogoUpload(buffer)
  if (!checked.ok) {
    await supabase.storage.from('session-assets').remove([storagePath])
    return NextResponse.json({ error: checked.error }, { status: checked.status })
  }
  const { logo } = checked
  if (logo.rewritten) {
    const { error: reuploadError } = await supabase.storage
      .from('session-assets')
      .upload(storagePath, logo.buffer, { contentType: logo.mime, upsert: true })
    if (reuploadError) {
      return NextResponse.json({ error: 'Failed to store sanitized logo' }, { status: 500 })
    }
  }

  const replaced = await replaceSessionLogoRow(supabase, id, {
    storagePath,
    fileName,
    mime: logo.mime,
    size: logo.buffer.length,
  })
  if (!replaced.ok) {
    console.error('[logo] asset row replace failed:', replaced.error)
    return NextResponse.json({ error: 'Failed to record logo asset' }, { status: 500 })
  }

  const { data: signed } = await supabase.storage
    .from('session-assets')
    .createSignedUrl(storagePath, 3600)

  return NextResponse.json({ assetId: replaced.assetId, logoUrl: signed?.signedUrl ?? null })
}
