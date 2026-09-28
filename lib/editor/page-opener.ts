// "Page opener" select for the content editor: maps one friendly choice to the
// frontmatter pair the template reads — `hero` (or legacy `hero_block`) +
// `hero_variant` (parse-page-md.ts; `hero` wins over `hero_block`, missing ⇒
// page-header). Pure + client-safe.
//
// hero `image-right` / `image-left` are dead values (they render full-bleed);
// the split layouts are `hero: hero-split`. A current pair that isn't one of the
// choices stays visible as "Custom: …" and is only replaced when the operator
// picks something else.

import { variantValuesAt, blockSpec } from '@/lib/content/block-catalog'
import type { Frontmatter } from './frontmatter'

export type PageOpenerChoice = {
  id: string
  label: string
  hero: 'page-header' | 'hero' | 'hero-split'
  /** null ⇒ no hero_variant line. */
  heroVariant: string | null
}

export const PAGE_OPENER_CHOICES: readonly PageOpenerChoice[] = [
  { id: 'page-header', label: 'Page header', hero: 'page-header', heroVariant: null },
  { id: 'split-right', label: 'Split, image right', hero: 'hero-split', heroVariant: 'image-right' },
  { id: 'split-left', label: 'Split, image left', hero: 'hero-split', heroVariant: 'image-left' },
  { id: 'statement', label: 'Statement', hero: 'hero', heroVariant: 'statement' },
  { id: 'image', label: 'Full-bleed image', hero: 'hero', heroVariant: 'image' },
  { id: 'video', label: 'Video', hero: 'hero', heroVariant: 'video' },
  { id: 'slider', label: 'Slider', hero: 'hero', heroVariant: 'slider' },
]

/** The choices a template at `templateVersion` renders. */
export function pageOpenerChoices(templateVersion?: string | null): PageOpenerChoice[] {
  return PAGE_OPENER_CHOICES.filter((c) => {
    if (c.heroVariant === null) return true
    return variantValuesAt(blockSpec(c.hero)?.variants ?? [], templateVersion).includes(c.heroVariant)
  })
}

export type PageOpenerSelectState = {
  /** The select's value: a choice id, or CUSTOM_OPENER for the custom row. */
  value: string
  /** Label of the leading custom row, when the current pair isn't offered. */
  customLabel?: string
  choices: PageOpenerChoice[]
}

export const CUSTOM_OPENER = '__custom'

/**
 * What the Page opener select shows at this template version. A current pair
 * that is unknown — or a known choice this site's template doesn't render
 * (filtered out by version) — stays visible as a leading custom row, so the
 * select never silently displays a different value than the page has.
 */
export function pageOpenerSelectState(fm: Frontmatter, templateVersion?: string | null): PageOpenerSelectState {
  const choices = pageOpenerChoices(templateVersion)
  const current = currentPageOpener(fm)
  if (current.kind === 'custom') return { value: CUSTOM_OPENER, customLabel: current.label, choices }
  if (choices.some((c) => c.id === current.id)) return { value: current.id, choices }
  const label = PAGE_OPENER_CHOICES.find((c) => c.id === current.id)?.label ?? current.id
  return { value: CUSTOM_OPENER, customLabel: `Custom: ${label} (not available on this site's template)`, choices }
}

// Frontmatter values are raw YAML scalars; the opener fields are plain words.
function bare(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim()
}

/** The key the template reads the opener from: `hero`, else a legacy `hero_block`. */
function heroKey(fm: Frontmatter): 'hero' | 'hero_block' {
  return !('hero' in fm.fields) && 'hero_block' in fm.fields ? 'hero_block' : 'hero'
}

export type CurrentPageOpener =
  | { kind: 'choice'; id: string }
  | { kind: 'custom'; label: string }

/** Which choice the page's current pair matches, or a "Custom: …" label. */
export function currentPageOpener(fm: Frontmatter): CurrentPageOpener {
  const hero = bare(fm.fields[heroKey(fm)])
  const variant = bare(fm.fields.hero_variant)
  const custom = (): CurrentPageOpener => ({
    kind: 'custom',
    label: `Custom: ${hero || '(no hero)'}${variant ? ` / ${variant}` : ''}`,
  })
  if (!hero || hero === 'page-header') return variant ? custom() : { kind: 'choice', id: 'page-header' }
  const spec = blockSpec(hero)
  if (!spec || spec.placement !== 'frontmatter') return custom()
  const effective = variant || spec.default
  const match = PAGE_OPENER_CHOICES.find((c) => c.hero === hero && c.heroVariant === effective)
  return match ? { kind: 'choice', id: match.id } : custom()
}

/** Frontmatter with the opener pair set for `choiceId` (unknown id ⇒ unchanged). */
export function applyPageOpener(fm: Frontmatter, choiceId: string): Frontmatter {
  const choice = PAGE_OPENER_CHOICES.find((c) => c.id === choiceId)
  if (!choice) return fm
  const key = heroKey(fm)
  const fields = { ...fm.fields, [key]: choice.hero }
  let order = fm.order.includes(key) ? fm.order : [...fm.order, key]
  if (choice.heroVariant === null) {
    delete fields.hero_variant
    order = order.filter((k) => k !== 'hero_variant')
  } else {
    fields.hero_variant = choice.heroVariant
    if (!order.includes('hero_variant')) {
      // Keep the pair together: hero_variant right after the hero key.
      const at = order.indexOf(key)
      order = [...order.slice(0, at + 1), 'hero_variant', ...order.slice(at + 1)]
    }
  }
  return { ...fm, fields, order }
}

// A frontmatter value is present when it's a non-empty scalar, a non-empty
// inline array, or a block list (`key:` followed by `- item` lines).
function hasValue(fm: Frontmatter, key: string): boolean {
  if ((fm.arrayFields[key]?.length ?? 0) > 0) return true
  const v = bare(fm.fields[key])
  if (v !== '' && v !== '[]') return true
  return fm.blocks?.[key]?.lines.some((l) => l.trim().startsWith('-')) ?? false
}

/** Operator hints for the current opener (media the variant needs but lacks). */
export function pageOpenerHints(fm: Frontmatter): string[] {
  const current = currentPageOpener(fm)
  if (current.kind !== 'choice') return []
  if (current.id === 'video' && !hasValue(fm, 'hero_video')) {
    return ['No hero_video is set yet, so the hero shows its still image. Add hero_video in code view.']
  }
  if (current.id === 'slider' && !hasValue(fm, 'hero_images')) {
    return ['No hero_images are set yet, so the hero shows its still image. Add hero_images in code view.']
  }
  return []
}

/**
 * The page's main heading as the live site renders it, for the editor preview:
 * the template shows `hero_headline` on hero / hero-split openers, else the
 * `title` up to the first " | " (the "| Firm" SEO suffix never renders). Mirrors
 * T src/lib/assembly/extract-block-props.ts (heroHeadline / page-header).
 */
export function previewHeading(fm: Frontmatter | null | undefined): string {
  if (!fm) return ''
  const title = bare(fm.fields.title).split(' | ')[0].trim()
  const hero = bare(fm.fields[heroKey(fm)])
  const headline = bare(fm.fields.hero_headline).trim()
  if (headline && hero && hero !== 'page-header') return headline
  return title
}
