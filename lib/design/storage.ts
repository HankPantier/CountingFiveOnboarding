// Server-only. Design Studio images (renders, input captures, attachments) in
// the PRIVATE session-assets bucket under design/{sessionId}/…, always WebP,
// long edge ≤ 1568 px (the size vision models read without downsampling).
// Never getPublicUrl, never the `assets` table (that feeds deliverables).
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export const SCREENSHOT_MAX_EDGE = 1568
const BUCKET = 'session-assets'
const SIGNED_URL_TTL = 3600
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEGMENT_RE = /^[a-z0-9][a-z0-9._-]*$/i
// A 1440×900@2x screenshot is ~5M px; 40M leaves headroom while bounding
// decode memory against a maliciously huge image.
const MAX_INPUT_PIXELS = 40_000_000
const MAX_SEGMENT_LENGTH = 200
const MAX_SEGMENTS = 8

export async function toWebp(image: Buffer): Promise<{ webp: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(image, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize({ width: SCREENSHOT_MAX_EDGE, height: SCREENSHOT_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true })
  return { webp: data, width: info.width, height: info.height }
}

export function designStoragePath(sessionId: string, ...segments: string[]): string {
  if (!UUID_RE.test(sessionId)) throw new Error('designStoragePath: invalid session id')
  if (
    segments.length === 0 ||
    segments.length > MAX_SEGMENTS ||
    segments.some((s) => !SEGMENT_RE.test(s) || s.includes('..') || s.length > MAX_SEGMENT_LENGTH)
  ) {
    throw new Error('designStoragePath: invalid path segment')
  }
  return `design/${sessionId}/${segments.join('/')}`
}

export async function storeDesignImage(supabase: SupabaseClient<Database>, path: string, webp: Buffer): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, webp, { contentType: 'image/webp', upsert: false })
  if (error) throw new Error(`storeDesignImage failed: ${error.message}`)
}

export async function signDesignPaths(supabase: SupabaseClient<Database>, paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL)
  if (error || !data) throw new Error(`signDesignPaths failed: ${error?.message ?? 'no data'}`)
  const out: Record<string, string> = {}
  for (const row of data) if (row.path && row.signedUrl) out[row.path] = row.signedUrl
  return out
}

// Read a Design Studio image's bytes (service-role client — the bucket is
// private) so the concept generator can send it to the model INLINE. Never
// hand the model a signed URL. Only design/… paths.
export async function downloadDesignImage(supabase: SupabaseClient<Database>, path: string): Promise<Uint8Array> {
  if (!path.startsWith('design/') || path.includes('..')) throw new Error('downloadDesignImage: not a design path')
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) throw new Error(`downloadDesignImage failed: ${error?.message ?? 'no data'}`)
  return new Uint8Array(await data.arrayBuffer())
}

// Delete Design Studio objects. Only design/… paths are ever removed (defence
// against a bad stored path deleting a client upload or PDF). Throws on a
// storage error; callers treat cleanup as best-effort and log.
export async function removeDesignPaths(supabase: SupabaseClient<Database>, paths: string[]): Promise<void> {
  const safe = paths.filter((p) => p.startsWith('design/') && !p.includes('..'))
  if (safe.length === 0) return
  const { error } = await supabase.storage.from(BUCKET).remove(safe)
  if (error) throw new Error(`removeDesignPaths failed: ${error.message}`)
}
