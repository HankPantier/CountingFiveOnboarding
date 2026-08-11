// Server-side "import a headshot from a URL" for one team member: fetch the
// image (SSRF-guarded), validate it by magic bytes, store it in the private
// session-assets bucket, and record a team-photo asset tagged to the member.
// Shared by the rep's manual pull route and the audit → session-start auto-pull
// so the two never drift. Node runtime only (node:dns, binary fetch, file-type).
import { fileTypeFromBuffer } from 'file-type'
import type { createServerClient } from '@/lib/supabase/server'
import { isUrlPubliclyFetchable } from '@/lib/audit/ssrf-guard'
import { safeGetBinary } from '@/lib/audit/crawl'
import { asJson } from '@/lib/supabase/json-typed'

type SupabaseServerClient = ReturnType<typeof createServerClient>

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

export interface PullHeadshotArgs {
  supabase: SupabaseServerClient
  sessionId: string
  memberName: string
  imageUrl: string
  /** When true, do nothing if the member already has a team-photo asset. The
   * auto-pull path sets this so a re-run never duplicates; the manual "Swap"
   * flow leaves it false so a rep can always replace a photo. */
  skipIfExists?: boolean
}

export type PullHeadshotResult =
  | { status: 'created'; assetId: string; storagePath: string }
  | { status: 'skipped' }
  | { status: 'error'; error: string; httpStatus: number }

async function memberHasPhoto(
  supabase: SupabaseServerClient,
  sessionId: string,
  memberName: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('assets')
    .select('id')
    .eq('session_id', sessionId)
    .eq('asset_category', 'team-photo')
    .eq('metadata->>team_member_name', memberName)
    .limit(1)
  return !!data?.length
}

/** Import one member's headshot from a live-site URL. Never throws — returns a
 * typed result the caller maps to a response (route) or logs (auto-pull). */
export async function pullHeadshotForMember(args: PullHeadshotArgs): Promise<PullHeadshotResult> {
  const { supabase, sessionId, memberName, imageUrl, skipIfExists = false } = args

  if (skipIfExists && (await memberHasPhoto(supabase, sessionId, memberName))) {
    return { status: 'skipped' }
  }

  // SSRF gate the chosen URL up front; safeGetBinary re-checks every redirect.
  if (!(await isUrlPubliclyFetchable(imageUrl))) {
    return { status: 'error', error: 'Image URL is not fetchable', httpStatus: 400 }
  }

  const fetched = await safeGetBinary(imageUrl)
  if (!fetched) {
    return { status: 'error', error: 'Could not download the image', httpStatus: 502 }
  }

  // Never trust the response Content-Type — validate the actual bytes.
  const detected = await fileTypeFromBuffer(fetched.buffer)
  if (!detected || !isAllowedMime(detected.mime)) {
    return { status: 'error', error: 'Fetched file is not a supported image', httpStatus: 415 }
  }

  const fileName = fileNameFromUrl(imageUrl, EXT_BY_MIME[detected.mime])
  const storagePath = `sessions/${sessionId}/${crypto.randomUUID()}-${fileName}`

  const { error: uploadErr } = await supabase.storage
    .from('session-assets')
    .upload(storagePath, fetched.buffer, { contentType: detected.mime, upsert: false })
  if (uploadErr) {
    console.error('[team-photos/pull] upload', uploadErr)
    return { status: 'error', error: 'Failed to store image', httpStatus: 500 }
  }

  const { data: asset, error } = await supabase
    .from('assets')
    .insert({
      session_id: sessionId,
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

  if (error || !asset) {
    // Don't leave orphaned bytes if the row insert fails.
    await supabase.storage.from('session-assets').remove([storagePath])
    console.error('[team-photos/pull] insert', error)
    return { status: 'error', error: 'Failed to record asset', httpStatus: 500 }
  }

  return { status: 'created', assetId: asset.id, storagePath }
}
