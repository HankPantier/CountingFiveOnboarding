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
}

export type ValidationResult = {
  passed: boolean // true if no fatal errors (warnings don't affect this)
  warnings: string[]
  errors: ValidationError[]
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
    // Fatal rule 4: invalid variant
    // ------------------------------------------------------------------
    if (variant !== undefined && catalogEntry.variants.length > 0) {
      if (!catalogEntry.variants.includes(variant)) {
        errors.push({
          position,
          headingText,
          blockId,
          reason: `invalid variant '${variant}' for block '${blockId}' (valid: ${catalogEntry.variants.join(', ')})`,
        })
        // Don't continue — remaining content rules can still run
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
    // Warning rule 14: missing image on content-split
    // ------------------------------------------------------------------
    if (blockId === 'content-split' && !ann.image) {
      warnings.push(
        `content-split at position ${position} has no image reference — manual asset assignment needed`,
      )
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
  }
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
  /<!-- block: ([a-z-]+)(?:\s*\|\s*variant:\s*([a-z0-9-]+))?(?:\s*\|\s*image:\s*([^\s>]+))?\s*-->\s*\n##\s+(.+?)\n([\s\S]*?)(?=\n<!-- block:|$)/g

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
