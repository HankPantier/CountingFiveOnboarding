import { NextResponse } from 'next/server'
import { fileTypeFromBuffer } from 'file-type'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { isUrlPubliclyFetchable } from '@/lib/audit/ssrf-guard'
import { safeGetBinary } from '@/lib/audit/crawl'
import { asJson } from '@/lib/supabase/json-typed'
import type { SessionSchema } from '@/types/session-schema'

// Node runtime: node:dns (SSRF guard), binary fetch, file-type magic bytes.
export const runtime = 'nodejs'

// Raster only — a real headshot. SVG is excluded (unsniffable, script-carrying).
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
const EXT_BY_MIME: Record<(typeof ALLOWED_MIMES)[number], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

function isAllowedMime(mime: string): mime is (typeof ALLOWED_MIMES)[number] {
  return (ALLOWED_MIMES as readonly string[]).includes(mime)
}

// Filename from the source URL's path, forced to the sniffed extension so the
// stored name is honest. Falls back to "headshot" for extension-less paths.
function fileNameFromUrl(url: string, ext: string): string {
  let name = 'headshot'
  try {
    const last = new URL(url).pathname.split('/').pop()
    if (last) name = last
  } catch {
    /* keep fallback */
  }
  name = name.replace(/\.[a-z0-9]+$/i, '')
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'headshot'
  return `${safe}.${ext}`
}

// POST { memberName, imageUrl } — server-side fetch the rep-chosen live-site
// image, validate it by magic bytes, store it as a team-photo asset for that
// member (mirrors /api/upload/confirm). One member per call.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireSessionAccess(id)
  if (auth instanceof NextResponse) return auth

  let body: { memberName?: unknown; imageUrl?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { memberName, imageUrl } = body
  if (typeof memberName !== 'string' || !memberName.trim()) {
    return NextResponse.json({ error: 'memberName is required' }, { status: 400 })
  }
  if (typeof imageUrl !== 'string' || !imageUrl) {
    return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // Only tag photos to members that actually exist on the profile — blocks
  // arbitrary metadata being written to the assets table.
  const schema = (session.schema_data as SessionSchema | null) ?? {}
  const team = Array.isArray(schema.team) ? schema.team : []
  if (!team.some((m) => m.name === memberName)) {
    return NextResponse.json({ error: 'Unknown team member' }, { status: 400 })
  }

  // SSRF gate the chosen URL up front; safeGetBinary re-checks every redirect.
  if (!(await isUrlPubliclyFetchable(imageUrl))) {
    return NextResponse.json({ error: 'Image URL is not fetchable' }, { status: 400 })
  }

  const fetched = await safeGetBinary(imageUrl)
  if (!fetched) {
    return NextResponse.json({ error: 'Could not download the image' }, { status: 502 })
  }

  // Never trust the response Content-Type — validate the actual bytes.
  const detected = await fileTypeFromBuffer(fetched.buffer)
  if (!detected || !isAllowedMime(detected.mime)) {
    return NextResponse.json({ error: 'Fetched file is not a supported image' }, { status: 415 })
  }

  const fileName = fileNameFromUrl(imageUrl, EXT_BY_MIME[detected.mime])
  const storagePath = `sessions/${id}/${crypto.randomUUID()}-${fileName}`

  const { error: uploadErr } = await supabase.storage
    .from('session-assets')
    .upload(storagePath, fetched.buffer, { contentType: detected.mime, upsert: false })
  if (uploadErr) {
    console.error('[team-photos/pull] upload', uploadErr)
    return NextResponse.json({ error: 'Failed to store image' }, { status: 500 })
  }

  const { data: asset, error } = await supabase
    .from('assets')
    .insert({
      session_id: id,
      file_name: fileName,
      storage_path: storagePath,
      public_url: null,
      mime_type: detected.mime,
      file_size_bytes: fetched.buffer.byteLength,
      asset_category: 'team-photo',
      metadata: asJson({ team_member_name: memberName, source_url: imageUrl }),
    })
    .select('id')
    .single()

  if (error) {
    // Don't leave orphaned bytes if the row insert fails.
    await supabase.storage.from('session-assets').remove([storagePath])
    console.error('[team-photos/pull] insert', error)
    return NextResponse.json({ error: 'Failed to record asset' }, { status: 500 })
  }

  return NextResponse.json({ assetId: asset.id, storagePath })
}
