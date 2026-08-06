// ---------------------------------------------------------------------------
// Block Annotation Validator
// Pure, sync, no I/O. Validates <!-- block: --> annotations in generated
// page content against the rules defined in raw-docs/phaseII/block-annotation-spec.md
// (Validator: Block Assignment Rules section).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BlockAnnotation = {
  blockId: string
  variant?: string
  image?: string
  headingText: string
  sectionContent: string // raw markdown body of the section (heading excluded)
  position: number // 0-based section index
}

export type ValidationError = {
  position: number
  headingText: string
  blockId: string
  reason: string
  suggestion?: string // block ID we'd suggest instead
  fix?: 'add-image' // the block is fine — it just needs an image: attribute
}

export type AnnotationCoercion = {
  position: number
  blockId: string
  originalVariant: string
  coercedVariant: string
}

export type ValidationResult = {
  passed: boolean // true if no fatal errors (warnings don't affect this)
  warnings: string[]
  errors: ValidationError[]
  coercions: AnnotationCoercion[] // invalid variants that were auto-fixed
}

// ---------------------------------------------------------------------------
// Block catalog
// ---------------------------------------------------------------------------

type BlockMeta = {
  variants: readonly string[]
  frontmatterOnly?: true
  autoAppended?: true
}

const BLOCK_CATALOG: Readonly<Record<string, BlockMeta>> = {
  // Hero-category blocks — may only appear in frontmatter, not inline
  hero: { variants: ['image', 'video', 'slider'], frontmatterOnly: true },
  'page-header': { variants: [], frontmatterOnly: true },
  'hero-split': { variants: ['image-right', 'image-left'], frontmatterOnly: true },

  // Content blocks
  'intro-text': { variants: ['centered', 'left-aligned'] },
  'content-split': { variants: ['image-right', 'image-left'] },
  'content-prose': { variants: [] },
  'checklist-section': { variants: ['with-image', 'standalone'] },
  'process-steps': { variants: ['horizontal', 'vertical'] },

  // Card grids
  'feature-grid': { variants: ['3-col', '4-col'] },
  'service-cards': { variants: ['2-col', '3-col'] },
  'content-cards': { variants: ['3-col', '2-col'] },
  'team-grid': { variants: ['2-col', '3-col', '4-col'] },
  'industry-cards': { variants: ['3-col', '4-col'] },

  // Social proof
  testimonials: { variants: ['carousel', 'grid'] },
  'stats-bar': { variants: ['3-up', '4-up'] },
  'logo-bar': { variants: [] },

  // Conversion
  'cta-banner': { variants: ['color-bg', 'image-bg'] },
  pricing: { variants: ['2-tier', '3-tier', '4-tier'] },
  'faq-accordion': { variants: [], autoAppended: true }, // never Claude-selected
  form: { variants: ['contact', 'quote', 'newsletter'] },

  // Utility
  'content-table': { variants: [] },
} as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HERO_BLOCKS = new Set(['hero', 'hero-split', 'page-header'])

/**
 * Count pricing-tier markers in a section body.
 * A tier is signaled by:
 *  - A subheading line (## or ###)
 *  - A strong-emphasis price like **$X**
 *  - A line that starts with a price ($\d+)
 */
function countPricingTiers(content: string): number {
  const lines = content.split('\n')
  let count = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^#{2,3}\s+/.test(trimmed)) { count++; continue }
    if (/\*\*\$\d+/.test(trimmed)) { count++; continue }
    if (/^\$\d+/.test(trimmed)) { count++ }
  }
  return count
}

/**
 * Count named person markers in a section body.
 * A person is signaled by:
 *  - A subheading line (###)
 *  - A **Name** strong-emphasis pattern
 */
function countPeopleMarkers(content: string): number {
  const lines = content.split('\n')
  let count = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^###\s+/.test(trimmed)) { count++; continue }
    if (/\*\*[A-Z][a-zA-Z\s]+\*\*/.test(trimmed)) { count++ }
  }
  return count
}

// ---------------------------------------------------------------------------
// Core validator
// ---------------------------------------------------------------------------

export function validateBlockAnnotations(
  annotations: BlockAnnotation[],
  _pageUrl: string,
  _faqBlock: { question: string; answer: string }[],
): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: string[] = []
  const coercions: AnnotationCoercion[] = []
  const total = annotations.length

  for (let i = 0; i < total; i++) {
    const ann = annotations[i]
    const { blockId, variant, sectionContent, position, headingText } = ann

    // ------------------------------------------------------------------
    // Fatal rule 1: hero/hero-split/page-header as inline annotation
    // ------------------------------------------------------------------
    if (HERO_BLOCKS.has(blockId)) {
      const suggestion = blockId === 'page-header' ? 'intro-text' : 'content-prose'
      errors.push({
        position,
        headingText,
        blockId,
        reason:
          'hero/hero-split/page-header may only appear in frontmatter, not as inline section annotations',
        suggestion,
      })
      continue // no point running further rules on this annotation
    }

    // ------------------------------------------------------------------
    // Fatal rule 2: faq-accordion inline
    // ------------------------------------------------------------------
    if (blockId === 'faq-accordion') {
      errors.push({
        position,
        headingText,
        blockId,
        reason:
          'faq-accordion is auto-appended by the deliverable builder — do not select it during content generation',
        suggestion: 'content-prose',
      })
      continue
    }

    // ------------------------------------------------------------------
    // Fatal rule 3: invalid block ID
    // ------------------------------------------------------------------
    const catalogEntry = BLOCK_CATALOG[blockId]
    if (!catalogEntry) {
      errors.push({
        position,
        headingText,
        blockId,
        reason: `unknown block ID '${blockId}'`,
        suggestion: 'content-prose',
      })
      continue
    }

    // ------------------------------------------------------------------
    // Coercion rule 4: invalid variant (downgrade from fatal — auto-fix to first valid)
    // ------------------------------------------------------------------
    if (variant !== undefined && catalogEntry.variants.length > 0) {
      if (!catalogEntry.variants.includes(variant)) {
        const fallback = catalogEntry.variants[0]
        coercions.push({
          position,
          blockId,
          originalVariant: variant,
          coercedVariant: fallback,
        })
        warnings.push(
          `invalid variant '${variant}' on '${blockId}' at position ${position} — auto-coerced to '${fallback}' (valid: ${catalogEntry.variants.join(', ')})`
        )
        // Don't continue — remaining content rules can still run on this section
      }
    }

    // ------------------------------------------------------------------
    // Fatal rule 5: stats-bar without numbers
    // ------------------------------------------------------------------
    if (blockId === 'stats-bar' && !/\d/.test(sectionContent)) {
      errors.push({
        position,
        headingText,
        blockId,
        reason: 'stats-bar section must contain at least one numeric value',
        suggestion: 'feature-grid',
      })
    }

    // ------------------------------------------------------------------
    // Fatal rule 6: pricing without tiers
    // ------------------------------------------------------------------
    if (blockId === 'pricing') {
      const tierCount = countPricingTiers(sectionContent)
      if (tierCount < 2) {
        errors.push({
          position,
          headingText,
          blockId,
          reason: 'pricing section must contain at least 2 tier definitions',
          suggestion: 'feature-grid',
        })
      }
    }

    // ------------------------------------------------------------------
    // Fatal rule 7: team-grid without people
    // ------------------------------------------------------------------
    if (blockId === 'team-grid') {
      const peopleCount = countPeopleMarkers(sectionContent)
      if (peopleCount < 2) {
        errors.push({
          position,
          headingText,
          blockId,
          reason: 'team-grid section must reference at least 2 named individuals',
          suggestion: 'content-cards',
        })
      }
    }

    // ------------------------------------------------------------------
    // Fatal rule 8: form at non-terminal position
    // ------------------------------------------------------------------
    if (blockId === 'form' && position < total - 2) {
      errors.push({
        position,
        headingText,
        blockId,
        reason: 'form must be in the last 2 sections of the page',
        suggestion: 'cta-banner',
      })
    }

    // ------------------------------------------------------------------
    // Fatal rule 9: cta-banner at position 0
    // ------------------------------------------------------------------
    if (blockId === 'cta-banner' && position === 0) {
      errors.push({
        position,
        headingText,
        blockId,
        reason: 'cta-banner cannot be the first section of a page',
        suggestion: 'intro-text',
      })
    }

    // ------------------------------------------------------------------
    // Warning rule 10: consecutive content-split with same variant
    // ------------------------------------------------------------------
    if (blockId === 'content-split' && i > 0) {
      const prev = annotations[i - 1]
      if (
        prev.blockId === 'content-split' &&
        variant !== undefined &&
        prev.variant === variant
      ) {
        warnings.push(
          `consecutive content-split sections at positions ${prev.position} and ${position} use the same variant '${variant}' — alternate image-right and image-left for visual rhythm`,
        )
      }
    }

    // ------------------------------------------------------------------
    // Warning rule 12: intro-text after intro-text
    // ------------------------------------------------------------------
    if (blockId === 'intro-text' && i > 0 && annotations[i - 1].blockId === 'intro-text') {
      warnings.push(
        `consecutive intro-text sections at positions ${annotations[i - 1].position} and ${position} — likely a structural issue`,
      )
    }

    // ------------------------------------------------------------------
    // Warning rule 13: content-prose with short copy
    // ------------------------------------------------------------------
    if (blockId === 'content-prose') {
      const wordCount = sectionContent.split(/\s+/).filter(Boolean).length
      if (wordCount < 150) {
        warnings.push(
          `content-prose at position ${position} has fewer than 150 words — consider intro-text instead`,
        )
      }
    }

    // ------------------------------------------------------------------
    // Error rule 14: mandatory images. Images are structural for these
    // blocks — a miss triggers the single retry, and ensureBlockMedia
    // injects a deterministic placeholder as the final backstop.
    // ------------------------------------------------------------------
    if (blockId === 'content-split' && !ann.image) {
      errors.push({
        position,
        headingText,
        blockId,
        reason: 'content-split requires an image: + query: on its annotation (imagery is mandatory)',
        fix: 'add-image',
      })
    }
    if (
      blockId === 'checklist-section' &&
      !ann.image &&
      (ann.variant === 'with-image' || ann.variant === undefined)
    ) {
      errors.push({
        position,
        headingText,
        blockId,
        reason: 'checklist-section (with-image) requires an image: + query: on its annotation',
        fix: 'add-image',
      })
    }
    if (blockId === 'cta-banner' && ann.variant === 'image-bg' && !ann.image) {
      errors.push({
        position,
        headingText,
        blockId,
        reason: 'image-bg cta-banner requires an image: + query: on its annotation',
        fix: 'add-image',
      })
    }

    // ------------------------------------------------------------------
    // Warning rule 15: items missing icons on icon-bearing card blocks.
    // Warning only — the template renders a CheckCircle fallback, and
    // icon misses shouldn't consume the retry that image misses need.
    // ------------------------------------------------------------------
    if (['feature-grid', 'industry-cards', 'service-cards'].includes(blockId)) {
      const lines = sectionContent.split('\n')
      let iconless = 0
      for (let li = 0; li < lines.length; li++) {
        const isItemTitle =
          /^###\s+/.test(lines[li].trim()) || /^\*\*[^*\n]+\*\*\s*$/.test(lines[li].trim())
        if (!isItemTitle) continue
        // Icon bullets (- IconName: **Title** — …) carry their own icon.
        let hasIcon = false
        for (let lj = li + 1; lj < lines.length; lj++) {
          if (lines[lj].trim() === '') continue
          hasIcon = /^icon:\s*[A-Za-z][A-Za-z0-9]*\s*$/.test(lines[lj].trim())
          break
        }
        if (!hasIcon) iconless++
      }
      if (iconless > 0) {
        warnings.push(
          `${blockId} at position ${position} has ${iconless} item(s) without an icon: line — template falls back to CheckCircle`,
        )
      }
    }
  }

  // -----------------------------------------------------------------------
  // Warning rule 11: no CTA or form on pages with 5+ sections
  // -----------------------------------------------------------------------
  if (total >= 5) {
    const lastTwo = annotations.slice(-2)
    const hasCtaOrForm = lastTwo.some(
      (a) => a.blockId === 'cta-banner' || a.blockId === 'form',
    )
    if (!hasCtaOrForm) {
      warnings.push(
        "page has 5+ sections but doesn't end with cta-banner or form",
      )
    }
  }

  return {
    passed: errors.length === 0,
    warnings,
    errors,
    coercions,
  }
}

// ---------------------------------------------------------------------------
// applyCoercions — given the raw markdown body and coercions from validation,
// rewrite the offending `<!-- block: <id> | variant: <bad> ... -->` annotations
// in place so the stored content_markdown carries valid variants downstream.
//
// Conservative: only substitutes the `variant: <oldValue>` token inside an
// annotation tag for the matching block-id. Other annotation parts (image,
// extra keys) are preserved. If a coercion doesn't match anything in the
// markdown (e.g. someone hand-edited the annotation between parse and apply),
// it's a no-op for that entry.
// ---------------------------------------------------------------------------
export function applyCoercions(markdown: string, coercions: AnnotationCoercion[]): string {
  let result = markdown
  for (const c of coercions) {
    // Match the annotation containing this exact blockId + originalVariant
    // pair, then rewrite the variant token. Escape regex-special chars in
    // the original variant just in case.
    const escapedVariant = c.originalVariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(
      `(<!--\\s*block:\\s*${c.blockId}\\s*\\|\\s*variant:\\s*)${escapedVariant}(\\s*(?:\\||-->))`,
      'g'
    )
    result = result.replace(pattern, `$1${c.coercedVariant}$2`)
  }
  return result
}

// ---------------------------------------------------------------------------
// parseBlockAnnotations
// ---------------------------------------------------------------------------

/**
 * Regex that matches each annotated section in the markdown body.
 * Groups:
 *   1 = blockId
 *   2 = variant (optional)
 *   3 = image (optional)
 *   4 = headingText
 *   5 = sectionContent (body below the heading before next annotation or EOF)
 */
const SECTION_PATTERN =
  /<!-- block: ([a-z-]+)(?:\s*\|\s*variant:\s*([a-z0-9-]+))?(?:\s*\|\s*image:\s*([^\s|>]+))?(?:\s*\|\s*alt:\s*"[^"]*")?(?:\s*\|\s*query:\s*"[^"]*")?\s*-->\s*\n##\s+(.+?)\n([\s\S]*?)(?=\n<!-- block:|$)/g

/**
 * Parse a full page markdown body into an array of BlockAnnotation entries.
 * The caller must have already stripped the YAML frontmatter; pass only the body.
 */
export function parseBlockAnnotations(body: string): BlockAnnotation[] {
  const results: BlockAnnotation[] = []
  let position = 0
  let match: RegExpExecArray | null

  // Reset lastIndex in case the regex is reused across calls
  SECTION_PATTERN.lastIndex = 0

  while ((match = SECTION_PATTERN.exec(body)) !== null) {
    results.push({
      blockId: match[1],
      variant: match[2] ?? undefined,
      image: match[3] ?? undefined,
      headingText: match[4].trim(),
      sectionContent: match[5] ?? '',
      position: position++,
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// validateAnnotationSyntax
// Lightweight, edit-time check: are every block's id and variant valid against
// the catalog? Unlike validateBlockAnnotations (which also runs content
// heuristics like "stats-bar needs a number" and positional rules), this only
// flags the two things an interactive layout edit can break — an unknown block
// id or a variant that isn't allowed for its block. It never rejects a page for
// pre-existing content-shape issues the edit didn't introduce. Pass the page
// body with frontmatter already stripped. Returns [] when the annotations parse
// cleanly.
// ---------------------------------------------------------------------------
export function validateAnnotationSyntax(body: string): string[] {
  const errors: string[] = []
  for (const ann of parseBlockAnnotations(body)) {
    const entry = BLOCK_CATALOG[ann.blockId]
    if (!entry) {
      errors.push(
        `Unknown block id "${ann.blockId}" on section "${ann.headingText}". Valid ids: ${Object.keys(BLOCK_CATALOG).join(', ')}.`
      )
      continue
    }
    if (ann.variant !== undefined && entry.variants.length > 0 && !entry.variants.includes(ann.variant)) {
      errors.push(
        `Invalid variant "${ann.variant}" for block "${ann.blockId}" on section "${ann.headingText}". Valid variants: ${entry.variants.join(', ')}.`
      )
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// buildCorrectionPrompt
// ---------------------------------------------------------------------------

/**
 * Build a targeted re-prompt string for a single fatal ValidationError.
 * The content-generator caller sends this to Claude instead of regenerating
 * the full page.
 */
export function buildCorrectionPrompt(
  error: ValidationError,
  sectionContent: string,
): string {
  const truncated =
    sectionContent.length > 800
      ? sectionContent.slice(0, 800) + '\n[...truncated]'
      : sectionContent

  const suggestion = error.suggestion ?? 'content-prose'

  return `The following section annotation is invalid:
Section ${error.position} ("${error.headingText}").
Current annotation: <!-- block: ${error.blockId} -->
Issue: ${error.reason}

Current section content:
${truncated}

Suggested replacement: <!-- block: ${suggestion} -->

Return ONLY the corrected annotation line and the unchanged heading + content for this section. Do not regenerate the rest of the page.`
}
