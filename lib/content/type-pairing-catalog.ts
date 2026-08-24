export type TypePairingFeel = 'classic' | 'modern' | 'editorial' | 'warm'

export type TypePairing = {
  id: string
  label: string
  feel: TypePairingFeel
  headingFont: string
  bodyFont: string
  description: string
  googleFontsUrl: string
  /** Italic-serif accent role (Ink & Clay) for emphasis words + numerals.
   * Omitted → the template's universal default (Fraunces) applies. */
  accentFont?: string
}

export function gfUrl(families: string[]): string {
  // Each family: "Family Name:wght@400;700"
  const params = families
    .map(f => `family=${f.replace(/ /g, '+')}:wght@400;500;700`)
    .join('&')
  return `https://fonts.googleapis.com/css2?${params}&display=swap`
}

export const TYPE_PAIRINGS: readonly TypePairing[] = [
  // Modern
  { id: 'modern-sans', label: 'Modern Sans', feel: 'modern',
    headingFont: 'Inter', bodyFont: 'Inter',
    description: 'Clean, neutral, broadly applicable. The safe modern default.',
    googleFontsUrl: gfUrl(['Inter']) },
  { id: 'geometric-pro', label: 'Geometric Pro', feel: 'modern',
    headingFont: 'Manrope', bodyFont: 'Manrope',
    description: 'Geometric sans with a slightly warmer feel than Inter.',
    googleFontsUrl: gfUrl(['Manrope']) },
  { id: 'civic-modern', label: 'Civic Modern', feel: 'modern',
    headingFont: 'Public Sans', bodyFont: 'Public Sans',
    description: 'Trustworthy, government-grade legibility. Strong default for CPA firms.',
    googleFontsUrl: gfUrl(['Public Sans']) },
  { id: 'corporate-clean', label: 'Corporate Clean', feel: 'modern',
    headingFont: 'Plus Jakarta Sans', bodyFont: 'Plus Jakarta Sans',
    description: 'Confident corporate sans with a touch of personality.',
    googleFontsUrl: gfUrl(['Plus Jakarta Sans']) },

  // Editorial
  { id: 'classic-editorial', label: 'Classic Editorial', feel: 'editorial',
    headingFont: 'Source Serif 4', bodyFont: 'Source Sans 3',
    description: 'Serif headlines, sans body. Sophisticated and considered.',
    googleFontsUrl: gfUrl(['Source Serif 4', 'Source Sans 3']) },
  { id: 'civic-editorial', label: 'Civic Editorial', feel: 'editorial',
    headingFont: 'IBM Plex Serif', bodyFont: 'IBM Plex Sans',
    description: 'Technical-feeling editorial pair from IBM. Modernist serif.',
    googleFontsUrl: gfUrl(['IBM Plex Serif', 'IBM Plex Sans']) },
  { id: 'refined-modern', label: 'Refined Modern', feel: 'editorial',
    headingFont: 'Fraunces', bodyFont: 'Inter',
    description: 'Soft variable serif with crisp sans body. Modern editorial.',
    googleFontsUrl: gfUrl(['Fraunces', 'Inter']) },
  { id: 'journal', label: 'Journal', feel: 'editorial',
    headingFont: 'Lora', bodyFont: 'Inter',
    description: 'Reading-rooted serif with a clean sans body.',
    googleFontsUrl: gfUrl(['Lora', 'Inter']) },

  // Classic
  { id: 'heritage', label: 'Heritage', feel: 'classic',
    headingFont: 'Playfair Display', bodyFont: 'Source Sans 3',
    description: 'High-contrast classic serif with a workhorse sans body.',
    googleFontsUrl: gfUrl(['Playfair Display', 'Source Sans 3']) },
  { id: 'traditional-pro', label: 'Traditional Pro', feel: 'classic',
    headingFont: 'Merriweather', bodyFont: 'Open Sans',
    description: 'Sturdy reading serif with a familiar humanist sans.',
    googleFontsUrl: gfUrl(['Merriweather', 'Open Sans']) },
  { id: 'legal-pad', label: 'Legal Pad', feel: 'classic',
    headingFont: 'Libre Caslon Text', bodyFont: 'Libre Franklin',
    description: 'Caslon revival with grotesque sans body. Old-world authority.',
    googleFontsUrl: gfUrl(['Libre Caslon Text', 'Libre Franklin']) },

  // Warm
  { id: 'warm-approachable', label: 'Warm Approachable', feel: 'warm',
    headingFont: 'Nunito', bodyFont: 'Nunito',
    description: 'Rounded, friendly sans throughout.',
    googleFontsUrl: gfUrl(['Nunito']) },
  { id: 'friendly-rounded', label: 'Friendly Rounded', feel: 'warm',
    headingFont: 'DM Sans', bodyFont: 'DM Sans',
    description: 'Geometric sans with softened corners. Friendly but precise.',
    googleFontsUrl: gfUrl(['DM Sans']) },
  { id: 'warm-editorial', label: 'Warm Editorial', feel: 'warm',
    headingFont: 'DM Serif Display', bodyFont: 'Nunito Sans',
    description: 'High-contrast warm serif paired with a soft sans.',
    googleFontsUrl: gfUrl(['DM Serif Display', 'Nunito Sans']) },
  { id: 'humanist', label: 'Humanist', feel: 'warm',
    headingFont: 'Bitter', bodyFont: 'Karla',
    description: 'Slab-leaning warm serif with a balanced humanist sans.',
    googleFontsUrl: gfUrl(['Bitter', 'Karla']) },
] as const

// The curated, deduped font families used across the pairings, for the Theme
// Studio per-slot font pickers and the typography validator. Fraunces is the
// template's default accent, so it's always available.
export const CURATED_FONTS: readonly string[] = Array.from(
  new Set([
    ...TYPE_PAIRINGS.flatMap((p) => [p.headingFont, p.bodyFont, ...(p.accentFont ? [p.accentFont] : [])]),
    'Fraunces',
  ])
).sort()

export function findPairing(id: string): TypePairing | undefined {
  return TYPE_PAIRINGS.find(p => p.id === id)
}

export function pairingsByFeel(): Record<TypePairingFeel, TypePairing[]> {
  const groups: Record<TypePairingFeel, TypePairing[]> = {
    modern: [], editorial: [], classic: [], warm: [],
  }
  for (const p of TYPE_PAIRINGS) groups[p.feel].push(p)
  return groups
}
