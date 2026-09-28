// Pure + client-safe. Mirror of the client template's block catalog contract
// (counting-five-client-template src/lib/assembly/block-catalog.ts), parity-tested
// byte for byte against its docs/design/blocks.json (__fixtures__/blocks.template.json).
// Copy that file, don't retype it. The source of the platform's block vocabulary:
// the annotation validator, the editor's annotation codec + outline labels, and
// the Design Studio brief catalog all read from here.
//
// - placement: inline = a body section; frontmatter = page opener (hero +
//   hero_variant); auto = inserted by the platform's builders, never model-picked.
// - insertable: a content model or operator may add it to a page body.
// - default: what the template renders when the annotation has no variant.
// - variants[].since: first template release that renders the value
//   (BASELINE_SINCE = shipped before versioning began).
// - variants[].layout: a structural layout variant (template 2026.09.9+,
//   data-layout on the section root); wins over the site-wide layout preset.
// - themes: accepted `theme:` values (ink = the deep band).

/** Field order the template parser's annotation regex requires (parse-page-md.ts). */
export const ANNOTATION_FIELD_ORDER = ['variant', 'image', 'alt', 'query', 'theme'] as const

/** `since` for every value that shipped before 2026.09.1 started versioning. */
export const BASELINE_SINCE = '2026.09.1'

/** First release with layout variants + layout presets. */
export const LAYOUTS_SINCE = '2026.09.9'

export type BlockPlacement = 'inline' | 'frontmatter' | 'auto'
export type BlockVariantSpec = { value: string; since: string; layout?: true }
export type BlockSpec = {
  label: string
  placement: BlockPlacement
  insertable: boolean
  default: string | null
  variants: readonly BlockVariantSpec[]
  themes: readonly string[]
}

// Generic so BlockVariant<B> stays a literal union (the extractor parity test needs it).
function v<T extends string>(...values: T[]): { value: T; since: string }[] {
  return values.map((value) => ({ value, since: BASELINE_SINCE }))
}
/** Layout variants (data-layout on the section root), first shipped in `since`. */
function layout<T extends string>(since: string, ...values: T[]): { value: T; since: string; layout: true }[] {
  return values.map((value) => ({ value, since, layout: true as const }))
}

export const BLOCK_CATALOG = {
  // Page openers (frontmatter `hero` + `hero_variant`)
  hero: { label: 'Hero', placement: 'frontmatter', insertable: false, default: 'image', variants: v('statement', 'image', 'video', 'slider'), themes: [] },
  'hero-split': { label: 'Split hero', placement: 'frontmatter', insertable: false, default: 'image-right', variants: v('image-right', 'image-left'), themes: [] },
  'page-header': { label: 'Page header', placement: 'frontmatter', insertable: false, default: null, variants: [], themes: [] },

  // Content
  'intro-text': { label: 'Intro text', placement: 'inline', insertable: true, default: 'centered', variants: v('centered', 'left-aligned'), themes: [] },
  'content-split': { label: 'Text + image', placement: 'inline', insertable: true, default: 'image-right', variants: v('image-right', 'image-left'), themes: [] },
  'content-prose': { label: 'Text', placement: 'inline', insertable: true, default: null, variants: [], themes: [] },
  'checklist-section': {
    label: 'Checklist',
    placement: 'inline',
    insertable: true,
    default: 'standalone',
    variants: v('with-image', 'with-image-right', 'with-image-left', 'standalone'),
    themes: [],
  },
  'process-steps': { label: 'Process steps', placement: 'inline', insertable: true, default: 'vertical', variants: v('horizontal', 'vertical'), themes: [] },

  // Card grids
  'feature-grid': { label: 'Feature grid', placement: 'inline', insertable: true, default: '3-col', variants: [...v('3-col', '4-col'), ...layout(LAYOUTS_SINCE, 'list')], themes: ['ink'] },
  'service-cards': { label: 'Services', placement: 'inline', insertable: true, default: '3-col', variants: [...v('2-col', '3-col'), ...layout(LAYOUTS_SINCE, 'list')], themes: ['ink'] },
  'content-cards': { label: 'Content cards', placement: 'inline', insertable: true, default: '3-col', variants: [...v('3-col', '2-col'), ...layout(LAYOUTS_SINCE, 'list')], themes: [] },
  'team-grid': { label: 'Team', placement: 'inline', insertable: true, default: '3-col', variants: [...v('2-col', '3-col', '4-col'), ...layout(LAYOUTS_SINCE, 'list')], themes: [] },
  'industry-cards': { label: 'Industries', placement: 'inline', insertable: true, default: '3-col', variants: v('3-col', '4-col'), themes: ['ink'] },

  // Social proof
  testimonials: { label: 'Testimonials', placement: 'inline', insertable: true, default: 'grid', variants: [...v('carousel', 'grid'), ...layout(LAYOUTS_SINCE, 'featured')], themes: [] },
  'stats-bar': { label: 'Stats', placement: 'inline', insertable: true, default: '3-up', variants: v('3-up', '4-up'), themes: ['ink'] },
  'logo-bar': { label: 'Logos', placement: 'inline', insertable: true, default: null, variants: [], themes: [] },

  // Conversion
  'cta-banner': {
    label: 'Call to action',
    placement: 'inline',
    insertable: true,
    default: 'color-bg',
    variants: [...v('color-bg', 'image-bg'), ...layout(LAYOUTS_SINCE, 'color-bg-centered', 'image-bg-centered')],
    themes: ['ink'],
  },
  pricing: { label: 'Pricing', placement: 'inline', insertable: true, default: '3-tier', variants: v('2-tier', '3-tier', '4-tier'), themes: [] },
  'faq-accordion': { label: 'FAQ', placement: 'auto', insertable: false, default: null, variants: [], themes: [] },
  form: { label: 'Form', placement: 'inline', insertable: true, default: 'contact', variants: v('contact', 'quote', 'newsletter', 'custom'), themes: [] },

  // Utility
  'content-table': { label: 'Table', placement: 'inline', insertable: true, default: null, variants: [], themes: [] },

  // Data- and config-driven (content comes from brand.json / site.config / JSON)
  'contact-info': { label: 'Contact details', placement: 'auto', insertable: false, default: null, variants: [], themes: [] },
  map: { label: 'Map', placement: 'auto', insertable: false, default: null, variants: [], themes: [] },
  booking: { label: 'Booking', placement: 'inline', insertable: false, default: null, variants: [], themes: [] },
  'resource-list': { label: 'Resources', placement: 'inline', insertable: false, default: null, variants: [], themes: [] },
  'pricing-calculator': { label: 'Pricing calculator', placement: 'auto', insertable: false, default: null, variants: [], themes: [] },
  'pricing-plans': { label: 'Pricing plans', placement: 'auto', insertable: false, default: null, variants: [], themes: [] },
} as const satisfies Record<string, BlockSpec>

export type BlockId = keyof typeof BLOCK_CATALOG
export type BlockVariant<B extends BlockId> = (typeof BLOCK_CATALOG)[B]['variants'][number]['value']
export const BLOCK_IDS = Object.keys(BLOCK_CATALOG) as BlockId[]

export function blockCatalogJson(): string {
  return (
    JSON.stringify(
      { version: 1, baselineSince: BASELINE_SINCE, fieldOrder: ANNOTATION_FIELD_ORDER, blocks: BLOCK_CATALOG },
      null,
      2,
    ) + '\n'
  )
}

// ---------------------------------------------------------------------------
// Platform helpers (not part of the mirrored JSON).
// ---------------------------------------------------------------------------

/** The catalog entry for an id, or undefined for an unknown id. */
export function blockSpec(blockId: string): BlockSpec | undefined {
  return Object.prototype.hasOwnProperty.call(BLOCK_CATALOG, blockId)
    ? (BLOCK_CATALOG as Record<string, BlockSpec>)[blockId]
    : undefined
}

/** Valid variant values for a block ([] for unknown or variant-less ids). */
export function blockVariantValues(blockId: string): string[] {
  return blockSpec(blockId)?.variants.map((v) => v.value) ?? []
}

/** Friendly label for a block id; unknown ids fall back to the raw id. */
export function blockLabel(blockId: string): string {
  return blockSpec(blockId)?.label ?? blockId
}

// ---------------------------------------------------------------------------
// Template versions (`YYYY.MM.N` — N is unbounded, so compare numerically:
// 2026.09.10 > 2026.09.9).
// ---------------------------------------------------------------------------

const VERSION_RE = /^\d+(?:\.\d+)*$/

/** True for a well-formed template version string. */
export function isTemplateVersion(v: unknown): v is string {
  return typeof v === 'string' && VERSION_RE.test(v)
}

/**
 * Numeric, segment-wise comparison: <0 when a < b, 0 when equal, >0 when a > b.
 * Missing trailing segments count as 0. Malformed input sorts below every
 * valid version (and equal to other malformed input) so it never unlocks more.
 */
export function compareTemplateVersions(a: string, b: string): number {
  const va = isTemplateVersion(a)
  const vb = isTemplateVersion(b)
  if (!va || !vb) return va === vb ? 0 : va ? 1 : -1
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/**
 * The version the block vocabulary is filtered at: the given template version,
 * clamped up to BASELINE_SINCE (baseline values shipped before versioning, so
 * every template renders them); no/malformed marker ⇒ the baseline.
 */
export function catalogVersion(templateVersion: string | null | undefined): string {
  return isTemplateVersion(templateVersion) && compareTemplateVersions(templateVersion, BASELINE_SINCE) > 0
    ? templateVersion
    : BASELINE_SINCE
}

/** The variant values a template at `templateVersion` renders (since ≤ version). */
export function variantValuesAt(variants: readonly BlockVariantSpec[], templateVersion: string | null | undefined): string[] {
  const at = catalogVersion(templateVersion)
  return variants.filter((v) => compareTemplateVersions(v.since, at) <= 0).map((v) => v.value)
}

/** Variant values of a block that a template at `templateVersion` renders. */
export function blockVariantValuesAt(blockId: string, templateVersion: string | null | undefined): string[] {
  return variantValuesAt(blockSpec(blockId)?.variants ?? [], templateVersion)
}

/**
 * The newest `since` at or below `templateVersion` across the whole catalog —
 * every version with the same epoch sees the same vocabulary, so prompt
 * prefixes can be cached per epoch instead of per version string.
 */
export function catalogEpoch(templateVersion: string | null | undefined): string {
  const at = catalogVersion(templateVersion)
  let epoch = BASELINE_SINCE
  for (const id of BLOCK_IDS) {
    for (const v of (BLOCK_CATALOG as Record<string, BlockSpec>)[id].variants) {
      if (compareTemplateVersions(v.since, at) <= 0 && compareTemplateVersions(v.since, epoch) > 0) epoch = v.since
    }
  }
  return epoch
}
