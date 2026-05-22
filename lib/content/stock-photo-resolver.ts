import type { SupabaseClient } from '@supabase/supabase-js'
import { searchPexelsTop, downloadPexelsImage, type PexelsPhoto } from './pexels-fetcher'
import type { Database } from '@/types/database'

type AssetRow = Database['public']['Tables']['assets']['Row']

/**
 * Stock-photo resolver — orchestrates fetching Pexels images for pages that
 * Claude flagged with a hero_image_query but don't have a matching uploaded
 * asset for the given hero_image filename.
 *
 * Lifecycle, per page:
 *   1. Skip if no hero_image_query (page-header heroes don't need photos).
 *   2. Skip if an asset for this session already exists with the same
 *      file_name AND asset_category in ('stock-photo', 'hero') — reuse
 *      existing photo so rebuilds are deterministic.
 *   3. Compose final query = subject + ", " + styleSuffix.
 *   4. searchPexels — returns the top landscape match or null.
 *   5. downloadPexelsImage — JPEG bytes or null.
 *   6. Upload bytes to Supabase Storage at sessions/<sessionId>/<file>.
 *   7. Insert row into `assets` table with:
 *        asset_category: 'stock-photo'
 *        metadata: { source: 'pexels', pexels_id, photographer,
 *                    photographer_url, pexels_url, original_query, final_query }
 *   8. Return the metadata so the caller can include it in CREDITS.md.
 *
 * If any step fails (no key, no result, download error, upload error), the
 * page is left without a stock photo — the package builder will see an
 * unresolved filename and the Phase II site falls back to whatever
 * placeholder behavior is in the Hero block.
 *
 * The caller (package route) supplies a service-role Supabase client so
 * uploads bypass RLS — these aren't user-initiated uploads.
 */

export type StockPhotoMetadata = {
  source: 'pexels'
  pexels_id: number
  photographer: string
  photographer_url: string
  pexels_url: string
  original_query: string
  final_query: string
  avg_color: string
}

export type ResolvedStockPhoto = {
  filename: string
  pageUrl: string
  metadata: StockPhotoMetadata
}

/**
 * A request to resolve one Pexels photo, sourced from anywhere — page hero,
 * inline content-split annotation, content-card entry, etc. The resolver
 * doesn't care about provenance; the package route assembles refs from
 * multiple sources and passes them all in.
 */
export type ImageRef = {
  /** Page URL this image is referenced from. Used for CREDITS grouping. */
  pageUrl: string
  /** Filename the deliverable will use (and the assets table key). */
  filename: string
  /** Subject-only query (3-8 words). Builder appends styleSuffix at fetch time. */
  subjectQuery: string
  /** Free-text source label for logging: "hero" | "content-split" | "content-cards" */
  source?: string
}

export type StockResolverInput = {
  sessionId: string
  apiKey: string
  styleSuffix: string
  /** Existing session assets — used to short-circuit when an asset for this filename already exists */
  existingAssets: AssetRow[]
  imageRefs: ImageRef[]
}

export async function resolveStockPhotos(
  input: StockResolverInput,
  supabase: SupabaseClient<Database>
): Promise<ResolvedStockPhoto[]> {
  if (!input.apiKey) {
    console.warn('[stock-photo] PEXELS_API_KEY not set — skipping stock-photo resolution')
    return []
  }

  const resolved: ResolvedStockPhoto[] = []
  const existingByName = new Map<string, AssetRow>()
  for (const a of input.existingAssets) existingByName.set(a.file_name, a)

  // Track Pexels photo IDs already chosen this run (so two pages with
  // similar subjects don't accidentally get the same photo) AND already
  // assigned to existing stock-photo assets in this session (so reruns
  // don't pick photos that other pages historically claimed). Pre-seed
  // from existing assets' metadata.
  const usedPexelsIds = new Set<number>()
  for (const a of input.existingAssets) {
    if (a.asset_category !== 'stock-photo') continue
    const m = a.metadata as StockPhotoMetadata | null
    if (m?.source === 'pexels' && typeof m.pexels_id === 'number') {
      usedPexelsIds.add(m.pexels_id)
    }
  }

  // De-duplicate by filename: if two refs target the same filename, only
  // fetch once. Same image just gets reused.
  const seenFilenames = new Set<string>()

  for (const ref of input.imageRefs) {
    const filename = ref.filename?.trim()
    const subjectQuery = ref.subjectQuery?.trim()
    if (!filename || !subjectQuery) continue
    if (seenFilenames.has(filename)) continue
    seenFilenames.add(filename)

    // Reuse existing photo if we already have one for this filename
    const existing = existingByName.get(filename)
    if (existing) {
      // Surface its metadata for CREDITS.md if it's a Pexels stock photo
      const meta = existing.metadata as StockPhotoMetadata | null
      if (meta?.source === 'pexels') {
        resolved.push({ filename, pageUrl: ref.pageUrl, metadata: meta })
      }
      continue
    }

    const finalQuery = input.styleSuffix
      ? `${subjectQuery}, ${input.styleSuffix}`
      : subjectQuery

    // Pull the top 10 results so we can skip any that are already used
    // elsewhere in this session. Pexels' rate cost is the same as per_page=1.
    const candidates = await searchPexelsTop(finalQuery, input.apiKey, 10)
    if (candidates.length === 0) {
      console.warn(`[stock-photo] No Pexels result for ${filename} (query="${finalQuery}", source=${ref.source ?? 'hero'})`)
      continue
    }
    let photo: PexelsPhoto | undefined = candidates.find(p => !usedPexelsIds.has(p.id))
    if (!photo) {
      // Every top result was already used — better to repeat than skip;
      // log so the operator can broaden queries if this happens often.
      console.warn(`[stock-photo] All ${candidates.length} top results already used in session for query="${finalQuery}" — reusing first`)
      photo = candidates[0]
    }
    usedPexelsIds.add(photo.id)

    const bytes = await downloadPexelsImage(photo.src_large)
    if (!bytes) {
      console.warn(`[stock-photo] Failed to download Pexels photo ${photo.id} for ${filename}`)
      continue
    }

    // Upload to Supabase Storage under the same path scheme as user uploads
    const storagePath = `sessions/${input.sessionId}/${filename}`
    const { error: uploadErr } = await supabase.storage
      .from('session-assets')
      .upload(storagePath, bytes, {
        contentType: 'image/jpeg',
        upsert: true,  // Idempotent — if storage already has the file but the DB row was missing, just overwrite
      })
    if (uploadErr) {
      console.warn(`[stock-photo] Storage upload failed for ${filename}: ${uploadErr.message}`)
      continue
    }

    // session-assets bucket is private; never store a public URL.
    // Admin viewers sign URLs on demand via Supabase storage createSignedUrl().

    const metadata: StockPhotoMetadata = {
      source: 'pexels',
      pexels_id: photo.id,
      photographer: photo.photographer,
      photographer_url: photo.photographer_url,
      pexels_url: photo.pexels_url,
      original_query: subjectQuery,
      final_query: finalQuery,
      avg_color: photo.avg_color,
    }

    const { error: insertErr } = await supabase
      .from('assets')
      .insert({
        session_id: input.sessionId,
        file_name: filename,
        storage_path: storagePath,
        public_url: null,
        mime_type: 'image/jpeg',
        file_size_bytes: bytes.length,
        asset_category: 'stock-photo',
        metadata: metadata as unknown as Database['public']['Tables']['assets']['Insert']['metadata'],
      })
    if (insertErr) {
      console.warn(`[stock-photo] Assets row insert failed for ${filename}: ${insertErr.message}`)
      // Storage already wrote — leave it; the next rebuild will retry insertion.
      continue
    }

    resolved.push({ filename, pageUrl: ref.pageUrl, metadata })
    console.warn(`[stock-photo] Resolved ${filename} ← Pexels #${photo.id} by ${photo.photographer} (source=${ref.source ?? 'hero'})`)
  }

  return resolved
}

/**
 * Build a CREDITS.md attribution document listing every Pexels photo used
 * in this deliverable, grouped by page. Pexels License doesn't legally
 * require attribution but it's the right move and protects against
 * licensing ambiguity if Pexels' terms ever change.
 */
export function buildCreditsMarkdown(resolved: ResolvedStockPhoto[]): string {
  if (resolved.length === 0) {
    return '# Image Credits\n\nNo stock photography was used in this deliverable.\n'
  }
  const lines: string[] = [
    '# Image Credits',
    '',
    'This site uses stock photography from [Pexels](https://www.pexels.com). All images are used under the [Pexels License](https://www.pexels.com/license/). Photographer credits are listed below.',
    '',
  ]
  // Sort by pageUrl then filename for stable diffs across rebuilds
  const sorted = [...resolved].sort((a, b) => {
    if (a.pageUrl !== b.pageUrl) return a.pageUrl.localeCompare(b.pageUrl)
    return a.filename.localeCompare(b.filename)
  })
  for (const r of sorted) {
    lines.push(`## ${r.pageUrl}`)
    lines.push('')
    lines.push(`- **File:** \`${r.filename}\``)
    lines.push(`- **Photographer:** [${r.metadata.photographer}](${r.metadata.photographer_url})`)
    if (r.metadata.pexels_url) {
      lines.push(`- **Pexels page:** ${r.metadata.pexels_url}`)
    }
    lines.push(`- **Search query:** \`${r.metadata.original_query}\``)
    lines.push('')
  }
  return lines.join('\n')
}
