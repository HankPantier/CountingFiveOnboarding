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

// Resolve a set of unique queries to hotlinkable URLs. Bounded-concurrency +
// time-boxed: a whole-site export can carry dozens of image queries, and each
// Pexels call can stall on the 10s request timeout or 429 back-off. Resolving
// them serially blew past the function's execution cap (the export just hung).
// So we run up to `concurrency` at once and stop launching new lookups past a
// soft `deadlineMs` — any query not resolved in time simply renders without an
// image rather than failing the whole export.
export async function resolveImageUrls(
  queries: Iterable<string>,
  apiKey: string,
  opts: { concurrency?: number; deadlineMs?: number } = {}
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!apiKey || !apiKey.trim()) return out

  const unique = Array.from(new Set(Array.from(queries).map((q) => q.trim()).filter(Boolean)))
  if (unique.length === 0) return out

  const concurrency = Math.max(1, opts.concurrency ?? 8)
  const deadline = Date.now() + (opts.deadlineMs ?? 45_000)

  let next = 0
  const worker = async () => {
    while (true) {
      if (Date.now() > deadline) return
      const idx = next++
      if (idx >= unique.length) return
      const q = unique[idx]
      try {
        const photo = await searchPexels(q, apiKey)
        if (photo?.src_large) out.set(q, photo.src_large)
      } catch {
        // Non-fatal — the block renders without an image.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker))
  return out
}
