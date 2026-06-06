// Block-level images ride in the block annotation comment:
//
//   <!-- block: content-split | variant: image-right | image: our-team.png | alt: "Accountants meeting a client" | query: "accountants meeting" -->
//
// The template's parser (parse-page-md.ts in the client repo) requires the
// parts in exactly this order — block, variant?, image?, alt?, query? — so
// the rewriter here preserves that ordering when adding or removing parts.

export const IMAGE_CAPABLE_BLOCKS = new Set([
  'content-split',
  'cta-banner',
  'checklist-section',
])

// Mirrors the template's block-comment regex (without the heading/body tail).
const BLOCK_COMMENT_RE =
  /<!-- block: ([a-z-]+)(?:\s*\|\s*variant:\s*([a-z0-9-]+))?(?:\s*\|\s*image:\s*([^\s|>]+))?(?:\s*\|\s*alt:\s*"([^"]*)")?(?:\s*\|\s*query:\s*"([^"]+)")?\s*-->/g

export type ImageBlockRef = {
  /** Position among ALL block comments in the body — stable rewrite target. */
  commentIndex: number
  blockId: string
  variant: string | null
  image: string | null
  alt: string | null
  query: string | null
  /** The `## …` heading that follows the comment, for display. */
  heading: string
}

function buildComment(ref: {
  blockId: string
  variant: string | null
  image: string | null
  alt: string | null
  query: string | null
}): string {
  let out = `<!-- block: ${ref.blockId}`
  if (ref.variant) out += ` | variant: ${ref.variant}`
  if (ref.image) out += ` | image: ${ref.image}`
  if (ref.image && ref.alt) out += ` | alt: "${ref.alt}"`
  if (ref.query) out += ` | query: "${ref.query}"`
  return `${out} -->`
}

// All image-capable blocks on the page, with or without an image set.
export function extractImageBlocks(body: string): ImageBlockRef[] {
  const refs: ImageBlockRef[] = []
  let commentIndex = -1
  for (const match of body.matchAll(BLOCK_COMMENT_RE)) {
    commentIndex++
    const [, blockId, variant, image, alt, query] = match
    if (!IMAGE_CAPABLE_BLOCKS.has(blockId)) continue
    const after = body.slice((match.index ?? 0) + match[0].length)
    const heading = after.match(/^\s*##\s+(.+)/)?.[1]?.trim() ?? ''
    refs.push({
      commentIndex,
      blockId,
      variant: variant ?? null,
      image: image ?? null,
      alt: alt ?? null,
      query: query ?? null,
      heading,
    })
  }
  return refs
}

type CommentRewrite = { image?: string | null; alt?: string | null }

function rewriteComment(body: string, ref: ImageBlockRef, change: CommentRewrite): string {
  let commentIndex = -1
  return body.replace(BLOCK_COMMENT_RE, (full, blockId, variant, image, alt, query) => {
    commentIndex++
    if (commentIndex !== ref.commentIndex) return full
    return buildComment({
      blockId,
      variant: variant ?? null,
      image: change.image !== undefined ? change.image : (image ?? null),
      alt: change.alt !== undefined ? change.alt : (alt ?? null),
      query: query ?? null,
    })
  })
}

// Rewrites the ref's block comment with a new image filename (null removes
// the image part — and its alt with it). Everything else is untouched.
export function setBlockImage(
  body: string,
  ref: ImageBlockRef,
  filename: string | null
): string {
  return rewriteComment(body, ref, filename ? { image: filename } : { image: null, alt: null })
}

// Rewrites just the alt description (null/empty removes it).
export function setBlockAlt(body: string, ref: ImageBlockRef, alt: string | null): string {
  const trimmed = alt?.trim().replace(/"/g, '') || null
  return rewriteComment(body, ref, { alt: trimmed })
}
