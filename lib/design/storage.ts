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

export async function toWebp(image: Buffer): Promise<{ webp: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(image)
    .resize({ width: SCREENSHOT_MAX_EDGE, height: SCREENSHOT_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true })
  return { webp: data, width: info.width, height: info.height }
}

export function designStoragePath(sessionId: string, ...segments: string[]): string {
  if (!UUID_RE.test(sessionId)) throw new Error('designStoragePath: invalid session id')
  if (segments.length === 0 || segments.some((s) => !SEGMENT_RE.test(s) || s.includes('..'))) {
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
