/**
 * Thin wrapper around the Pexels image search API.
 *
 * Used by the package-assembly stock-photo resolver to source hero images
 * (and later, content-split / content-card images) from Pexels when no
 * client-uploaded photo exists for that filename.
 *
 * API docs: https://www.pexels.com/api/documentation/
 * Free tier: 200 requests/hour (more than enough for our use case where we
 * fetch one image per page during deliverable assembly, and cache the
 * result in Supabase Storage so rebuilds don't re-fetch).
 *
 * No external HTTP client dependency — uses the native fetch API. Returns
 * null on any failure (timeout, rate limit, no results, missing API key,
 * malformed response) so callers can fall back to SVG placeholders without
 * tripping over exceptions.
 */

const PEXELS_SEARCH_URL = 'https://api.pexels.com/v1/search'
const REQUEST_TIMEOUT_MS = 10_000

export type PexelsPhoto = {
  /** Pexels' numeric ID for this photo — stored in assets.metadata for traceability */
  id: number
  /** Direct URL to the original-resolution JPEG (typically 2400x1600 or larger) */
  src_original: string
  /** A larger-than-needed URL we'd actually download (1280x800 area). Faster + smaller */
  src_large: string
  /** Photographer credit name */
  photographer: string
  /** Photographer's Pexels profile URL — required for the CREDITS.md attribution */
  photographer_url: string
  /** Width/height of the original image */
  width: number
  height: number
  /** Average dominant color as a hex string ("#aabbcc") — useful for blurhash-style placeholders */
  avg_color: string
  /** Pexels page URL for the image (where to attribute back to) */
  pexels_url: string
}

/**
 * Search Pexels for images matching `query`. Returns up to `perPage` results
 * (Pexels' relevance ranking) or an empty array if no match / API error.
 *
 * `apiKey` is the PEXELS_API_KEY from env. If empty or missing, returns []
 * without making a network call.
 *
 * Callers that just need the top result can use searchPexels (singular,
 * thin wrapper). The plural form exists so the resolver can dedupe across
 * pages in a session — when two pages would otherwise get the same photo,
 * pick the next-best result instead.
 */
export async function searchPexelsTop(
  query: string,
  apiKey: string,
  perPage = 1
): Promise<PexelsPhoto[]> {
  if (!apiKey || !apiKey.trim()) return []
  if (!query || !query.trim()) return []
  const safePerPage = Math.max(1, Math.min(perPage, 15))  // Pexels caps at 80; 15 is plenty for dedup

  const url = new URL(PEXELS_SEARCH_URL)
  url.searchParams.set('query', query)
  url.searchParams.set('per_page', String(safePerPage))
  url.searchParams.set('orientation', 'landscape')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: apiKey },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!res.ok) {
      console.warn(`[pexels-fetcher] Search failed: ${res.status} ${res.statusText} for query="${query}"`)
      return []
    }

    const data = await res.json() as {
      photos?: Array<{
        id?: number
        src?: { original?: string; large?: string; large2x?: string }
        photographer?: string
        photographer_url?: string
        width?: number
        height?: number
        avg_color?: string
        url?: string
      }>
    }

    const photos: PexelsPhoto[] = []
    for (const p of data.photos ?? []) {
      if (typeof p.id !== 'number' || !p.src?.original) continue
      photos.push({
        id: p.id,
        src_original: p.src.original,
        src_large: p.src.large2x ?? p.src.large ?? p.src.original,
        photographer: p.photographer ?? 'Unknown',
        photographer_url: p.photographer_url ?? '',
        width: p.width ?? 0,
        height: p.height ?? 0,
        avg_color: p.avg_color ?? '#808080',
        pexels_url: p.url ?? '',
      })
    }
    if (photos.length === 0) {
      console.warn(`[pexels-fetcher] No usable results for query="${query}"`)
    }
    return photos
  } catch (err) {
    clearTimeout(timeoutId)
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[pexels-fetcher] Search error for query="${query}": ${msg}`)
    return []
  }
}

/**
 * Thin wrapper that returns the top result only. Kept for callers that don't
 * need dedup — currently the regenerate admin route, which is always single-
 * image and per-asset. Resolver uses searchPexelsTop directly for dedup.
 */
export async function searchPexels(query: string, apiKey: string): Promise<PexelsPhoto | null> {
  const results = await searchPexelsTop(query, apiKey, 1)
  return results[0] ?? null
}

/**
 * Fetch the actual image bytes from a Pexels source URL. Returns a Buffer
 * suitable for uploading to Supabase Storage, or null on failure.
 *
 * Reuses the same timeout pattern as search() so a hung download can't
 * block the entire package-assembly pipeline.
 */
export async function downloadPexelsImage(srcUrl: string): Promise<Buffer | null> {
  if (!srcUrl) return null

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(srcUrl, { signal: controller.signal })
    clearTimeout(timeoutId)
    if (!res.ok) {
      console.warn(`[pexels-fetcher] Download failed: ${res.status} for ${srcUrl}`)
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0) {
      console.warn(`[pexels-fetcher] Empty body from ${srcUrl}`)
      return null
    }
    return buf
  } catch (err) {
    clearTimeout(timeoutId)
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[pexels-fetcher] Download error for ${srcUrl}: ${msg}`)
    return null
  }
}
