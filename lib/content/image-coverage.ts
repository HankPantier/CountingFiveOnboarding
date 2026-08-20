// ---------------------------------------------------------------------------
// Pure helpers shared by the package assembler and the whole-site image re-pull:
//   - collectPageImageRefs: flatten every hero + inline image reference across a
//     set of pages into one ImageRef list (deduped downstream by filename).
//   - computeImageCoverage: diff referenced image filenames against what
//     actually shipped, so a site that references N images but bundles fewer is
//     detected instead of silently rendering "Image not found".
// No DB / network — kept pure so both call sites and the tests share one truth.
// ---------------------------------------------------------------------------
import { extractInlineImageRefs } from './image-ref-extractor'
import type { ImageRef } from './stock-photo-resolver'

export type ImageRefPage = {
  page_url: string
  hero_image: string | null
  hero_image_query: string | null
  content_markdown: string | null
}

export type ImageCoverage = { expected: number; committed: number; missing: string[] }

// Every image a page set references: hero images (from generated_pages columns)
// + inline annotation/content-card images (parsed from content_markdown).
export function collectPageImageRefs(pages: ImageRefPage[]): ImageRef[] {
  const refs: ImageRef[] = []
  for (const p of pages) {
    if (p.hero_image && p.hero_image_query) {
      refs.push({ pageUrl: p.page_url, filename: p.hero_image, subjectQuery: p.hero_image_query, source: 'hero' })
    }
    refs.push(...extractInlineImageRefs(p.content_markdown ?? '', p.page_url))
  }
  return refs
}

// Distinct referenced filenames vs. what was bundled/committed. `missing`
// non-empty means those refs will render "Image not found".
export function computeImageCoverage(
  imageRefs: ImageRef[],
  bundledFilenames: Iterable<string>
): ImageCoverage {
  const bundled = bundledFilenames instanceof Set ? bundledFilenames : new Set(bundledFilenames)
  const referenced = Array.from(new Set(imageRefs.map(r => r.filename)))
  const missing = referenced.filter(f => !bundled.has(f))
  return { expected: referenced.length, committed: referenced.length - missing.length, missing }
}
