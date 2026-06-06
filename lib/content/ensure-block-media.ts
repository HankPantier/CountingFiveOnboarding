// ---------------------------------------------------------------------------
// ensureBlockMedia — deterministic image-coverage backstop.
// Pure, sync, no I/O. Runs after the generation retry, before the DB write:
// any block whose image is structural (content-split always, checklist-section
// unless standalone, cta-banner when image-bg) but still missing gets an
// `image:` + `query:` injected into its annotation comment, so the Pexels
// resolver is guaranteed something to fetch at package time. The admin can
// remove unwanted images later via the editor's Section images panel.
// ---------------------------------------------------------------------------

// Same comment grammar as lib/editor/block-images.ts and the template's
// parse-page-md.ts — part order MUST be: block | variant | image | alt | query.
const BLOCK_COMMENT_RE =
  /<!-- block: ([a-z-]+)(?:\s*\|\s*variant:\s*([a-z0-9-]+))?(?:\s*\|\s*image:\s*([^\s|>]+))?(?:\s*\|\s*alt:\s*"([^"]*)")?(?:\s*\|\s*query:\s*"([^"]+)")?\s*-->/g

const STOPWORDS = new Set([
  'the', 'and', 'a', 'an', 'your', 'our', 'for', 'to', 'of', 'with',
  'in', 'on', 'we', 'you', 'that', 'is', 'are', 'how', 'what', 'who',
])

function kebab(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

function pageSlug(pageUrl: string): string {
  return pageUrl.replace(/^\//, '').replace(/\//g, '--') || 'home'
}

// "Who We Work With in Healthcare" + "healthcare professionals"
// → "work healthcare professionals" (subject-only, ≤8 words)
export function deriveQuery(heading: string, targetKeyword: string): string {
  const words = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !STOPWORDS.has(w))

  const fromHeading = words(heading).slice(0, 4)
  const fromKeyword = words(targetKeyword).filter((w) => !fromHeading.includes(w)).slice(0, 2)
  const combined = [...fromHeading, ...fromKeyword].slice(0, 8)
  return combined.length > 0 ? combined.join(' ') : 'professional business office'
}

function needsImage(blockId: string, variant: string | undefined, image: string | undefined): boolean {
  if (image) return false
  if (blockId === 'content-split') return true
  // No-variant checklist defaults to with-image downstream — treat it as
  // image-bearing so "omit the variant" isn't a loophole.
  if (blockId === 'checklist-section') return variant !== 'standalone'
  if (blockId === 'cta-banner') return variant === 'image-bg'
  return false
}

export function ensureBlockMedia(
  markdown: string,
  pageUrl: string,
  targetKeyword: string
): string {
  const slug = pageSlug(pageUrl)

  return markdown.replace(
    BLOCK_COMMENT_RE,
    (full, blockId: string, variant: string | undefined, image: string | undefined, alt: string | undefined, query: string | undefined, offset: number) => {
      if (!needsImage(blockId, variant, image)) return full

      // Heading for this section: first `## ` line after THIS comment
      // (offset-based — identical comments elsewhere must not alias).
      const after = markdown.slice(offset + full.length)
      const heading = after.match(/^\s*##\s+(.+)/)?.[1]?.trim() ?? ''

      const filename = `${slug}--${kebab(heading) || blockId}.jpg`
      const derivedQuery = query ?? deriveQuery(heading, targetKeyword)

      let out = `<!-- block: ${blockId}`
      if (variant) out += ` | variant: ${variant}`
      out += ` | image: ${filename}`
      // No alt synthesis: the template already falls back to the section
      // heading, so injecting a heading-derived alt would add nothing.
      if (alt) out += ` | alt: "${alt}"`
      out += ` | query: "${derivedQuery}"`
      return `${out} -->`
    }
  )
}
