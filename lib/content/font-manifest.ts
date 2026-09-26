// Byte-parity port of the client template's src/lib/theme/font-manifest.ts
// (counting-five-client-template). Parity is tested against the template's
// docs/design/font-manifest.json (__fixtures__/font-manifest.template.json).
// Pure + client-safe.
export type FontManifestEntry = {
  family: string
  importName: string
  weights: readonly string[]
  italic: boolean
}

export const ROLE_WEIGHTS = ['400', '500', '700'] as const
export const MONO_FAMILY = 'Geist Mono'
export const DEFAULT_TYPOGRAPHY = { headingFont: 'Public Sans', bodyFont: 'Public Sans', accentFont: 'Fraunces' } as const

const W3: readonly string[] = ROLE_WEIGHTS
const f = (family: string, weights: readonly string[], italic = true): FontManifestEntry => ({
  family,
  importName: family.replace(/ /g, '_'),
  weights,
  italic,
})

export const FONT_MANIFEST: readonly FontManifestEntry[] = [
  f('Bitter', W3),
  f('DM Sans', W3),
  f('DM Serif Display', ['400']),
  f('Fraunces', W3),
  f('Geist Mono', W3, false),
  f('IBM Plex Sans', W3),
  f('IBM Plex Serif', W3),
  f('Inter', W3),
  f('Karla', W3),
  f('Libre Caslon Text', ['400', '700']),
  f('Libre Franklin', W3),
  f('Lora', W3),
  f('Manrope', W3, false),
  f('Merriweather', W3),
  f('Nunito', W3),
  f('Nunito Sans', W3),
  f('Open Sans', W3),
  f('Playfair Display', W3),
  f('Plus Jakarta Sans', W3),
  f('Public Sans', W3),
  f('Source Sans 3', W3),
  f('Source Serif 4', W3),
]

export function fontManifestJson(): string {
  return JSON.stringify({ version: 1, defaults: DEFAULT_TYPOGRAPHY, mono: MONO_FAMILY, fonts: FONT_MANIFEST }, null, 2) + '\n'
}
