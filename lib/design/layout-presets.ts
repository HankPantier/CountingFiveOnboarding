// Pure + client-safe. Mirror of the client template's site-wide layout presets
// (counting-five-client-template src/lib/theme/layout-presets.ts, template
// 2026.09.9), parity-tested against its docs/design/layout-presets.json
// (__fixtures__/layout-presets.template.json). design.json `layout` →
// <html data-c5-layout-*> → the per-section layout-variant rules in the
// template's src/styles/block-layouts.css, applied to the family's sections
// that carry no explicit `data-layout`.
//
// Precedence (template-side): an explicit per-section layout variant always
// wins; legacy column/background variants follow the preset; ink card bands
// never take one. Like logo.size, `layout` is a SIBLING design.json key — not a
// style axis — gated by the `layout-presets` capability flag (not a level).
// Zod-free on purpose (reaches the Theme Studio client chunk via
// compose-srcdoc); the zod input schema lives in layout-presets-schema.ts.

export const DEFAULT_LAYOUT_PRESET = 'default'

export const LAYOUT_PRESETS = {
  cards: {
    attribute: 'data-c5-layout-cards',
    blocks: ['service-cards', 'feature-grid', 'content-cards'],
    summary: 'Card grids (services, features, content cards): list = one item per row, media or icon left, text right.',
    values: ['default', 'list'],
  },
  ctaBanner: {
    attribute: 'data-c5-layout-cta-banner',
    blocks: ['cta-banner'],
    summary: 'Call-to-action banners: centered = heading, text and button stacked and centred.',
    values: ['default', 'centered'],
  },
  faq: {
    attribute: 'data-c5-layout-faq',
    blocks: ['faq-accordion'],
    summary: 'FAQ: split = heading in a left column, questions on the right (desktop).',
    values: ['default', 'split'],
  },
  team: {
    attribute: 'data-c5-layout-team',
    blocks: ['team-grid'],
    summary: 'Team: list = one member per row, photo left, credentials and bio right.',
    values: ['default', 'list'],
  },
  testimonials: {
    attribute: 'data-c5-layout-testimonials',
    blocks: ['testimonials'],
    summary: 'Testimonials (grid): featured = the first quote as a large pull quote, the rest below.',
    values: ['default', 'featured'],
  },
} as const

export type LayoutPresetName = keyof typeof LAYOUT_PRESETS
export type LayoutPresetValue<P extends LayoutPresetName> = (typeof LAYOUT_PRESETS)[P]['values'][number]
export type LayoutPresets = { [P in LayoutPresetName]?: LayoutPresetValue<P> }
export const LAYOUT_PRESET_NAMES = Object.keys(LAYOUT_PRESETS) as LayoutPresetName[]

export function layoutPresetsJson(): string {
  return JSON.stringify({ version: 1, defaultValue: DEFAULT_LAYOUT_PRESET, presets: LAYOUT_PRESETS }, null, 2) + '\n'
}

export const LAYOUT_PRESET_ATTRIBUTES: readonly string[] = LAYOUT_PRESET_NAMES.map((p) => LAYOUT_PRESETS[p].attribute)

const isPresetValue = (name: LayoutPresetName, v: unknown): boolean =>
  typeof v === 'string' && (LAYOUT_PRESETS[name].values as readonly string[]).includes(v)

// Canonical form stored in bundles: non-default values only; undefined when
// every preset is default (absent `layout` ≡ all default).
export function canonicalLayout(layout: LayoutPresets | undefined): LayoutPresets | undefined {
  if (!layout) return undefined
  const out: Record<string, string> = {}
  for (const name of LAYOUT_PRESET_NAMES) {
    const v = layout[name]
    if (v !== undefined && v !== DEFAULT_LAYOUT_PRESET && isPresetValue(name, v)) out[name] = v
  }
  return Object.keys(out).length ? (out as LayoutPresets) : undefined
}

// design.json `layout` is hand-editable: keep only known presets with valid values.
export function normalizeLayoutPresets(value: unknown): LayoutPresets | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  const picked: Record<string, string> = {}
  for (const name of LAYOUT_PRESET_NAMES) if (isPresetValue(name, v[name])) picked[name] = v[name] as string
  return canonicalLayout(picked as LayoutPresets)
}

// Order-insensitive equality of two (possibly absent) layouts, after canonicalizing.
export function sameLayout(a: unknown, b: unknown): boolean {
  const x = normalizeLayoutPresets(a) ?? {}
  const y = normalizeLayoutPresets(b) ?? {}
  return LAYOUT_PRESET_NAMES.every((n) => x[n] === y[n])
}

// For preview composition: every preset attribute, null = remove (the shell may
// carry the live site's presets, which the previewed design must override).
export function layoutPresetHtmlAttributes(layout: unknown): Record<string, string | null> {
  const l = normalizeLayoutPresets(layout) ?? {}
  const out: Record<string, string | null> = {}
  for (const name of LAYOUT_PRESET_NAMES) out[LAYOUT_PRESETS[name].attribute] = l[name] ?? null
  return out
}

// The preset (if any) that restructures a given block id under `layout`.
export function presetForBlock(
  layout: unknown,
  blockId: string
): { name: LayoutPresetName; value: string } | null {
  const l = normalizeLayoutPresets(layout)
  if (!l) return null
  for (const name of LAYOUT_PRESET_NAMES) {
    const v = l[name]
    if (v && (LAYOUT_PRESETS[name].blocks as readonly string[]).includes(blockId)) return { name, value: v }
  }
  return null
}

// One line per preset for prompts: "<prefix>cards: list — <summary>" (the
// prefix lets a prompt namespace them, e.g. "  - layout." next to the style
// axes, which also have a `cards`).
export function layoutPresetsSummary(prefix = '- '): string {
  return LAYOUT_PRESET_NAMES.map((p) => {
    const values = (LAYOUT_PRESETS[p].values as readonly string[]).filter((v) => v !== DEFAULT_LAYOUT_PRESET).join(' | ')
    return `${prefix}${p}: ${values} — ${LAYOUT_PRESETS[p].summary}`
  }).join('\n')
}

// Compact "cards=list, faq=split" rendering (critic summary, UI hints).
export function describeLayout(layout: unknown): string {
  const l = normalizeLayoutPresets(layout)
  if (!l) return 'all default'
  return LAYOUT_PRESET_NAMES.filter((n) => l[n]).map((n) => `${n}=${l[n]}`).join(', ')
}
