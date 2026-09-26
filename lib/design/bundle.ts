// The canonical, versionable Design Studio design: everything a concept, a chat
// revision, or a restore needs to fully reproduce a client's look. Pure +
// client-safe (zod only). CSS strings are NOT sanitized here — the server-side
// bundleToRepoFiles() runs every fragment through sanitizeDesignCss().
import { z } from 'zod'
import { PALETTE_ROLES, HEX_RE, LENGTH_RE } from '@/lib/editor/theme-edit'
import { CURATED_FONTS } from '@/lib/content/type-pairing-catalog'
import { CSS_TARGETS } from './css-targets'
import { canonicalStyle } from './style-axes'
import { StyleAxesInputSchema } from './style-axes-schema'

export const BUNDLE_SOURCES = ['baseline', 'concept', 'chat', 'revert', 'import'] as const

// The bundle `name` cap — also the target length for names derived at commit
// time (chat: from the turn's summary; revert: "Restored v{k}[ — {name}]"),
// see version-name.ts.
export const BUNDLE_NAME_MAX_LENGTH = 60

const hex = z.string().regex(HEX_RE, 'must be a #rrggbb hex colour').transform((s) => s.toLowerCase())
const length = z.string().regex(LENGTH_RE, 'must be a CSS length like 16px or 1.5rem')
const font = z.string().refine((f) => CURATED_FONTS.includes(f), 'must be a font from the curated list')

const paletteShape = Object.fromEntries(PALETTE_ROLES.map((r) => [r, hex])) as Record<
  (typeof PALETTE_ROLES)[number],
  typeof hex
>

export const DesignBundleSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(BUNDLE_NAME_MAX_LENGTH),
  tagline: z.string().max(160).default(''),
  rationale: z.string().max(2000).default(''),
  moves: z.array(z.string().max(200)).max(6).default([]),
  palette: z.object(paletteShape),
  typography: z.object({ headingFont: font, bodyFont: font, accentFont: font }),
  tokens: z.object({
    roundness: z.enum(['sharp', 'soft', 'pill']),
    density: z.enum(['tight', 'balanced', 'airy']),
    visualFeel: z.enum(['classic', 'modern', 'editorial']),
    spacing: z.object({ xs: length, sm: length, md: length, lg: length, xl: length, '2xl': length }),
    radius: z.object({ none: length, sm: length, md: length, lg: length, pill: length }),
  }),
  treatments: z.object({
    headlineStyle: z.enum(['sans', 'serif']),
    eyebrowStyle: z.enum(['standard', 'mono']),
    darkSections: z.boolean(),
  }),
  // Template style axes (L3+ only — below L3 the site's current style is held:
  // enforceCapabilities restores it, apply rejects a change, and an absent
  // style means "keep current" via keepLockedStyle). Canonicalized in parseDesignBundle (defaults dropped, undefined
  // when all default). No zod .transform here: it would make the inferred key
  // required and break every DesignBundle literal that omits `style`.
  style: StyleAxesInputSchema.optional(),
  css: z.object({
    global: z.string().optional(),
    blocks: z.partialRecord(z.enum(CSS_TARGETS), z.string()),
  }),
  meta: z.object({ source: z.enum(BUNDLE_SOURCES), model: z.string().optional() }),
})

export type DesignBundle = z.infer<typeof DesignBundleSchema>

export function parseDesignBundle(
  input: unknown
): { ok: true; bundle: DesignBundle } | { ok: false; errors: string[] } {
  const r = DesignBundleSchema.safeParse(input)
  if (r.success) {
    const style = canonicalStyle(r.data.style)
    const { style: _raw, ...rest } = r.data
    return { ok: true, bundle: style ? { ...rest, style } : rest }
  }
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
}
