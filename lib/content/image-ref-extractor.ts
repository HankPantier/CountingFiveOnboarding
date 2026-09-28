import type { ImageRef } from './stock-photo-resolver'
import { findBlockComments } from '@/lib/editor/block-annotation'

/**
 * Scan generated page markdown for inline image references in block
 * annotations and content-cards entries, returning a flat list of refs
 * the stock-photo resolver can iterate.
 *
 * Two surfaces handled here:
 *
 * 1. Block annotations carrying an image (content-split, image-bg cta-banner,
 *    with-image checklist-section):
 *      <!-- block: content-split | variant: image-right | image: filename.jpg | query: "subject only" -->
 *    The `query:` segment is optional. When absent, the filename slug
 *    (hyphens → spaces, extension stripped) becomes the query — good
 *    enough for secondary images even if Claude didn't volunteer a query.
 *    Annotations without an `image:` (color-bg banners, standalone
 *    checklists) are skipped.
 *
 * 2. content-cards individual cards (one per `### Title` chunk inside a
 *    `<!-- block: content-cards -->` section):
 *      ### Card Title
 *      photo: filename.jpg
 *      query: subject only
 *
 *      Card excerpt prose...
 *    Both `photo:` and `query:` lines are optional; without `photo:` the
 *    card is skipped entirely. Without `query:` the filename slug is used.
 *
 * Pure and never throws. Returns an empty array if markdown has no inline
 * image references.
 */

function filenameToQuery(filename: string): string {
  const noExt = filename.replace(/\.[a-z0-9]+$/i, '')
  return noExt.replace(/[-_]+/g, ' ').trim()
}

const IMAGE_BLOCKS = new Set(['content-split', 'cta-banner', 'checklist-section'])

export function extractInlineImageRefs(markdown: string, pageUrl: string): ImageRef[] {
  if (!markdown) return []
  const refs: ImageRef[] = []

  // 1. Image-bearing block annotations, read through the block-annotation
  // codec (template field order incl. a trailing `theme:`, so ink image-bg
  // banners are resolved and counted by the image-coverage gate). Only
  // comments the template renders (strict) count; annotations without an
  // image: fall through the !filename guard.
  for (const { comment: c } of findBlockComments(markdown)) {
    if (!c || !c.strict || !IMAGE_BLOCKS.has(c.blockId)) continue
    const filename = c.image?.trim()
    if (!filename) continue
    const queryRaw = c.query?.trim()
    const subjectQuery = queryRaw && queryRaw.length > 0 ? queryRaw : filenameToQuery(filename)
    refs.push({ pageUrl, filename, subjectQuery, source: c.blockId })
  }

  // 2. content-cards entries — find each content-cards block segment, then
  // within it walk each `### Title` chunk for `photo:` + optional `query:`
  // lines. The chunk boundary is the next `### ` heading or the end of the
  // block.
  const cardsSections = markdown.match(
    /<!-- block: content-cards[^>]*-->[\s\S]*?(?=\n<!-- block:|$)/g
  )
  if (cardsSections) {
    for (const section of cardsSections) {
      // Split each section into per-card chunks at `### ` boundaries
      const chunks = section.split(/(?=^### )/m).filter(c => c.trim().startsWith('### '))
      for (const chunk of chunks) {
        const photoMatch = chunk.match(/^photo:\s*(\S+)\s*$/m)
        const queryMatch = chunk.match(/^query:\s*(.+?)\s*$/m)
        const filename = photoMatch?.[1]?.trim()
        if (!filename) continue
        const queryRaw = queryMatch?.[1]?.trim().replace(/^["']|["']$/g, '')
        const subjectQuery = queryRaw && queryRaw.length > 0 ? queryRaw : filenameToQuery(filename)
        refs.push({ pageUrl, filename, subjectQuery, source: 'content-cards' })
      }
    }
  }

  return refs
}
