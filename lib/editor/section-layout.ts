// Per-section layout picker for the content editor (Sections outline) and the
// AI editor's set_section_layout tool. Pure + client-safe.
//
// A section's layout lives in its `<!-- block: X | variant: V | … | theme: T -->`
// annotation. layoutOptionsFor() says which values a block offers on this
// site's template (catalog `since` ≤ the draft's template version; no marker ⇒
// baseline) and flags a current value the catalog doesn't know as "not
// recognised" — it is shown, never silently rewritten. setSectionVariant /
// setSectionTheme rewrite exactly one annotation line (via the codec) and leave
// every other byte of the body identical; they refuse lead-in prose, stray or
// hand-mangled annotations, page openers and the FAQ (platform-managed), and
// return the body unchanged with a reason.

import {
  blockSpec,
  variantValuesAt,
  type BlockSpec,
} from '@/lib/content/block-catalog'
import { findBlockComments, serializeBlockComment, type BlockComment } from './block-annotation'
import { joinSections, type Section } from './markdown-sections'
import { partition } from './section-reorder'

// The "Ink band" toggle is offered only where it visibly changes the section.
// The catalog also accepts `theme: ink` on cta-banner and stats-bar, but both
// always render on the primary colour band, so the toggle would look broken
// there. Keep this list explicit (and a subset of each block's catalog themes).
export const INK_TOGGLE_BLOCKS: readonly string[] = ['feature-grid', 'service-cards', 'industry-cards']

// Ink bands that also re-flow the grid (the template renders a different card
// layout on the deep band), so the toggle warns about it.
const INK_CHANGES_LAYOUT: readonly string[] = ['feature-grid', 'industry-cards']

// Friendly names for catalog variant values. Unknown values fall back to a
// humanised form of the raw value.
const VARIANT_LABELS: Record<string, string> = {
  '2-col': '2 columns',
  '3-col': '3 columns',
  '4-col': '4 columns',
  '3-up': '3 across',
  '4-up': '4 across',
  '2-tier': '2 tiers',
  '3-tier': '3 tiers',
  '4-tier': '4 tiers',
  'image-right': 'Image right',
  'image-left': 'Image left',
  'with-image': 'With image (right)',
  'with-image-right': 'Image right',
  'with-image-left': 'Image left',
  standalone: 'No image',
  centered: 'Centered',
  'left-aligned': 'Left-aligned',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  carousel: 'Carousel',
  grid: 'Grid',
  'color-bg': 'Color background',
  'image-bg': 'Image background',
  contact: 'Contact',
  quote: 'Quote request',
  newsletter: 'Newsletter',
  custom: 'Custom',
}

export function variantLabel(value: string): string {
  if (VARIANT_LABELS[value]) return VARIANT_LABELS[value]
  const s = value.replace(/-/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : value
}

export type LayoutOption = {
  /** The annotation value; '' = no `variant:` field (variant-less blocks only). */
  value: string
  label: string
  /** False for a current value the catalog (at this template version) doesn't know. */
  recognised: boolean
}

export type SectionLayoutOptions = {
  /** Options for the Layout select, the current value always among them. */
  options: LayoutOption[]
  /** The select's current value (written variant, else the template default, else ''). */
  current: string
  /** False when the written variant isn't one this template renders. */
  currentRecognised: boolean
  /** Show the Layout select: more than one choice, or a value to flag. */
  showLayout: boolean
  /** Ink band toggle state; null = not offered for this block. */
  ink: { on: boolean; note?: string } | null
  /** A `theme:` value the block doesn't accept (shown as not recognised). */
  unrecognisedTheme?: string
}

export type LayoutOpts = { templateVersion?: string | null }

/**
 * What the layout picker offers for one section. `current` is the section's
 * written `variant` / `theme` ('' when absent).
 */
export function layoutOptionsFor(
  blockId: string,
  current: { variant: string; theme: string },
  opts: LayoutOpts = {},
): SectionLayoutOptions {
  const spec = blockSpec(blockId)
  const offered = spec && spec.placement !== 'frontmatter' ? variantValuesAt(spec.variants, opts.templateVersion) : []
  const written = current.variant.trim()
  const options: LayoutOption[] = offered.map((value) => ({
    value,
    label: spec?.default === value ? `${variantLabel(value)} (default)` : variantLabel(value),
    recognised: true,
  }))
  let currentValue = written || spec?.default || ''
  let currentRecognised = true
  if (written && !offered.includes(written)) {
    currentRecognised = false
    // Variant-less blocks: the only real choice is "no variant".
    if (offered.length === 0) options.push({ value: '', label: 'Standard', recognised: true })
    options.unshift({ value: written, label: `${written} (not recognised)`, recognised: false })
    currentValue = written
  } else if (!written && offered.length > 0 && !offered.includes(currentValue)) {
    // Defensive: a default missing from the version-filtered list.
    currentValue = offered[0]
  }

  const theme = current.theme.trim()
  const themes: readonly string[] = spec?.themes ?? []
  const inkOffered = INK_TOGGLE_BLOCKS.includes(blockId) && themes.includes('ink')
  const ink = inkOffered
    ? {
        on: theme === 'ink',
        ...(INK_CHANGES_LAYOUT.includes(blockId) ? { note: 'The ink band also changes the card layout.' } : {}),
      }
    : null

  return {
    options,
    current: currentValue,
    currentRecognised,
    showLayout: options.length > 1 || !currentRecognised,
    ink,
    ...(theme && !themes.includes(theme) ? { unrecognisedTheme: theme } : {}),
  }
}

export type SectionLayoutResult = { ok: true; body: string; changed: boolean } | { ok: false; body: string; reason: string }

// Indices are into the annotated sections (the pinned lead-in is never
// editable), matching describeSections() via the shared partition().
type Target = { spec: BlockSpec; section: Section; comment: BlockComment; commentRaw: string }

function resolveTarget(movable: Section[], index: number): Target | string {
  const section = movable[index]
  if (!section) return 'That section no longer exists.'
  if (!section.parseable) {
    return 'This section’s annotation is not in the template’s format (or has no heading), so its layout can’t be changed here. Fix it in code view.'
  }
  if (section.blockId === 'faq-accordion') return 'The FAQ layout is managed by the platform.'
  const spec = blockSpec(section.blockId)
  if (!spec) return `“${section.blockId}” is not a known block.`
  if (spec.placement === 'frontmatter') return 'Page openers are set with the Page opener control, not inline.'
  const found = findBlockComments(section.annotation)[0]
  if (!found?.comment) return 'This section’s annotation is not in the template’s format.'
  const { strict, ...comment } = found.comment
  if (!strict) return 'This section’s annotation is not in the template’s format.'
  return { spec, section, comment, commentRaw: found.raw }
}

function rewrite(
  body: string,
  index: number,
  // A new comment, a refusal reason, or null for "already set" (no-op).
  patch: (t: Target) => BlockComment | string | null,
): SectionLayoutResult {
  const { leadIn, movable } = partition(body)
  const target = resolveTarget(movable, index)
  if (typeof target === 'string') return { ok: false, body, reason: target }
  const next = patch(target)
  if (next === null) return { ok: true, body, changed: false }
  if (typeof next === 'string') return { ok: false, body, reason: next }
  const line = serializeBlockComment(next)
  if (line === target.commentRaw) return { ok: true, body, changed: false }
  // Swap only the comment; anything after `-->` on the line (e.g. trailing
  // whitespace) and every other section stay byte-identical.
  const annotation = target.section.annotation.replace(target.commentRaw, () => line)
  const nextMovable = movable.map((s, i) => (i === index ? { ...s, annotation } : s))
  return { ok: true, body: joinSections(leadIn ? [leadIn, ...nextMovable] : nextMovable), changed: true }
}

/**
 * Set (or with null, remove) a section's `variant`. The value must be one the
 * block offers at the site's template version; a value already written is
 * accepted as-is (a no-op), so an unrecognised legacy value is never rewritten
 * unless the operator picks something else.
 */
export function setSectionVariant(body: string, index: number, variant: string | null, opts: LayoutOpts = {}): SectionLayoutResult {
  return rewrite(body, index, ({ spec, comment, section }) => {
    const value = variant?.trim() || undefined
    if (value === comment.variant) return null
    if (value !== undefined) {
      const offered = variantValuesAt(spec.variants, opts.templateVersion)
      if (!offered.includes(value)) {
        return offered.length
          ? `“${value}” is not a layout for ${section.blockId} on this site (choose ${offered.join(', ')}).`
          : `${section.blockId} has no layout options.`
      }
    }
    return { ...comment, variant: value }
  })
}

/**
 * Set (or with null, remove) a section's `theme`. Only themes the block's
 * catalog entry accepts; removing is always allowed.
 */
export function setSectionTheme(body: string, index: number, theme: string | null): SectionLayoutResult {
  return rewrite(body, index, ({ spec, comment, section }) => {
    const value = theme?.trim() || undefined
    if (value === comment.theme) return null
    if (value !== undefined && !spec.themes.includes(value)) {
      return spec.themes.length
        ? `${section.blockId} does not support theme “${value}” (supported: ${spec.themes.join(', ')}).`
        : `${section.blockId} has no theme options.`
    }
    return { ...comment, theme: value }
  })
}
