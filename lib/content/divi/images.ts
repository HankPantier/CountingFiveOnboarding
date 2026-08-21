// ---------------------------------------------------------------------------
// Image resolution for the Divi export bridge (see ./README.md).
//
// The export hotlinks images rather than uploading to the WP Media Library, so
// each block's `query:` annotation is resolved to a stable public Pexels CDN
// URL (src_large) that we drop straight into the shortcode `src`. Queries are
// resolved once and deduped across the whole site. Fails soft: a query with no
// PEXELS_API_KEY / no result / an error resolves to null and the block renders
// without an image.
// ---------------------------------------------------------------------------

import { searchPexels } from '@/lib/content/pexels-fetcher'

export type ImageResolver = (query: string) => Promise<string | null>

// Resolve a set of unique queries to hotlinkable URLs. Sequential on purpose —
// this runs behind a manual admin button, and Pexels' free tier rate-limits
// bursts; a handful of serial lookups is well within budget.
export async function resolveImageUrls(
  queries: Iterable<string>,
  apiKey: string
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!apiKey || !apiKey.trim()) return out
  const unique = Array.from(new Set(Array.from(queries).map((q) => q.trim()).filter(Boolean)))
  for (const q of unique) {
    const photo = await searchPexels(q, apiKey)
    if (photo?.src_large) out.set(q, photo.src_large)
  }
  return out
}
