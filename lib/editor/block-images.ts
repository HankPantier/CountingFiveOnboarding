// Block-level images ride in the block annotation comment:
//
//   <!-- block: content-split | variant: image-right | image: our-team.png | alt: "Accountants meeting a client" | query: "accountants meeting" -->
//
// Parsing and rewriting go through the block-annotation codec, which keeps the
// template parser's field order (variant | image | alt | query | theme) — so an
// ink band (`| theme: ink`) keeps its theme and its image stays editable.

import { parseBlockComment, serializeBlockComment } from './block-annotation'

export const IMAGE_CAPABLE_BLOCKS = new Set([
  'content-split',
  'cta-banner',
  'checklist-section',
])

// Every block comment in the body (same `<!-- block:` prefix the template splits on).
const BLOCK_COMMENT_RE = /<!-- block:[^\n]*?-->/g

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
  /**
   * False when the comment only parsed leniently (wrong field order, unquoted
   * alt, stray keys). The template doesn't render it as written and the panel
   * never rewrites it — canonicalising would guess at the author's intent.
   */
  strict: boolean
}

// All image-capable blocks on the page, with or without an image set.
export function extractImageBlocks(body: string): ImageBlockRef[] {
  const refs: ImageBlockRef[] = []
  let commentIndex = -1
  for (const match of body.matchAll(BLOCK_COMMENT_RE)) {
    commentIndex++
    const c = parseBlockComment(match[0])
    if (!c || !IMAGE_CAPABLE_BLOCKS.has(c.blockId)) continue
    const after = body.slice((match.index ?? 0) + match[0].length)
    const heading = after.match(/^\s*##\s+(.+)/)?.[1]?.trim() ?? ''
    refs.push({
      commentIndex,
      blockId: c.blockId,
      variant: c.variant ?? null,
      image: c.image ?? null,
      alt: c.alt ?? null,
      query: c.query ?? null,
      heading,
      strict: c.strict,
    })
  }
  return refs
}

type CommentRewrite = { image?: string | null; alt?: string | null }

function rewriteComment(body: string, ref: ImageBlockRef, change: CommentRewrite): string {
  let commentIndex = -1
  return body.replace(BLOCK_COMMENT_RE, (full: string) => {
    commentIndex++
    if (commentIndex !== ref.commentIndex) return full
    const c = parseBlockComment(full)
    // Never canonicalise a leniently-parsed comment (see ImageBlockRef.strict).
    if (!c || !c.strict) return full
    const image = change.image !== undefined ? change.image : (c.image ?? null)
    const alt = change.alt !== undefined ? change.alt : (c.alt ?? null)
    // No image → no alt (the alt describes the image).
    return serializeBlockComment({
      blockId: c.blockId,
      variant: c.variant,
      image: image ?? undefined,
      alt: image && alt ? alt : undefined,
      query: c.query,
      theme: c.theme,
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
