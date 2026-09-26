// Pure + client-safe. Mirror of the client template's style-axis vocabulary
// (counting-five-client-template src/lib/theme/style-axes.ts), parity-tested
// against its docs/design/style-axes.json (__fixtures__/style-axes.template.json).
// Template T2: design.json `style` → <html data-c5-*> → src/styles/style-axes.css.
// Zod-free on purpose (it reaches the Theme Studio client chunk via
// compose-srcdoc); the zod input schema lives in style-axes-schema.ts.

export const DEFAULT_AXIS_VALUE = 'default'

export const STYLE_AXES = {
  sectionRhythm: {
    attribute: 'data-c5-section-rhythm',
    summary: 'Vertical padding between sections: compact = tighter, generous = roomier.',
    values: ['default', 'compact', 'generous'],
  },
  cards: {
    attribute: 'data-c5-cards',
    summary: 'Card surfaces: flat = tinted fill no shadow, outlined = stronger hairline no shadow, elevated = deeper shadow.',
    values: ['default', 'flat', 'outlined', 'elevated'],
  },
  buttons: {
    attribute: 'data-c5-buttons',
    summary: 'Button shape: pill = fully rounded, sharp = square corners, bold = uppercase tracked labels.',
    values: ['default', 'pill', 'sharp', 'bold'],
  },
  heroScale: {
    attribute: 'data-c5-hero-scale',
    summary: 'Hero headline size: compact = smaller, dramatic = larger display type.',
    values: ['default', 'compact', 'dramatic'],
  },
  imageTreatment: {
    attribute: 'data-c5-image-treatment',
    summary: 'Framed images: natural = no brand grade, mono = greyscale, rounded = larger corner radius.',
    values: ['default', 'natural', 'mono', 'rounded'],
  },
  nav: {
    attribute: 'data-c5-nav',
    summary: 'Top navigation: bordered = hairline under the bar, inverted = primary-colour bar with light text.',
    values: ['default', 'bordered', 'inverted'],
  },
  footer: {
    attribute: 'data-c5-footer',
    summary: 'Footer surface: light = muted light surface, brand = primary colour.',
    values: ['default', 'light', 'brand'],
  },
  accentUsage: {
    attribute: 'data-c5-accent-usage',
    summary: 'The italic accent word in headlines: subtle = headline colour, plain = no accent styling, underline = action-colour underline.',
    values: ['default', 'subtle', 'plain', 'underline'],
  },
} as const

export type StyleAxis = keyof typeof STYLE_AXES
export type StyleAxisValue<A extends StyleAxis> = (typeof STYLE_AXES)[A]['values'][number]
export type StyleAxes = { [A in StyleAxis]?: StyleAxisValue<A> }
export const STYLE_AXIS_NAMES = Object.keys(STYLE_AXES) as StyleAxis[]

export function styleAxesJson(): string {
  return JSON.stringify({ version: 1, defaultValue: DEFAULT_AXIS_VALUE, axes: STYLE_AXES }, null, 2) + '\n'
}

export const STYLE_AXIS_ATTRIBUTES: readonly string[] = STYLE_AXIS_NAMES.map((a) => STYLE_AXES[a].attribute)

const isAxisValue = (axis: StyleAxis, v: unknown): boolean =>
  typeof v === 'string' && (STYLE_AXES[axis].values as readonly string[]).includes(v)

// Canonical form stored in bundles: non-default values only; undefined when
// every axis is default (absent `style` ≡ all default).
export function canonicalStyle(style: StyleAxes | undefined): StyleAxes | undefined {
  if (!style) return undefined
  const out: Record<string, string> = {}
  for (const axis of STYLE_AXIS_NAMES) {
    const v = style[axis]
    if (v !== undefined && v !== DEFAULT_AXIS_VALUE && isAxisValue(axis, v)) out[axis] = v
  }
  return Object.keys(out).length ? (out as StyleAxes) : undefined
}

// design.json `style` is hand-editable: keep only known axes with valid values.
export function normalizeStyleAxes(value: unknown): StyleAxes | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  const picked: Record<string, string> = {}
  for (const axis of STYLE_AXIS_NAMES) if (isAxisValue(axis, v[axis])) picked[axis] = v[axis] as string
  return canonicalStyle(picked as StyleAxes)
}

// For preview composition: every axis attribute, null = remove (the shell may
// carry the live site's axes, which the previewed design must override).
export function styleAxisHtmlAttributes(style: unknown): Record<string, string | null> {
  const s = normalizeStyleAxes(style) ?? {}
  const out: Record<string, string | null> = {}
  for (const axis of STYLE_AXIS_NAMES) out[STYLE_AXES[axis].attribute] = s[axis] ?? null
  return out
}

// One line per axis for prompts: "cards: flat | outlined | elevated — <summary>".
export function styleAxesSummary(): string {
  return STYLE_AXIS_NAMES.map((a) => {
    const values = (STYLE_AXES[a].values as readonly string[]).filter((v) => v !== DEFAULT_AXIS_VALUE).join(' | ')
    return `- ${a}: ${values} — ${STYLE_AXES[a].summary}`
  }).join('\n')
}
