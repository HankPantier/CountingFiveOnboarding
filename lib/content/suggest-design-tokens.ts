import chroma from 'chroma-js'
import type { DesignTokens, Roundness, Density, VisualFeel } from '@/types/design-tokens'
import type { PaletteData } from '@/types/palette'
import type { SessionSchema } from '@/types/session-schema'
import { TYPE_PAIRINGS, findPairing, type TypePairingFeel } from './type-pairing-catalog'

const FEEL_KEYWORDS: Record<TypePairingFeel, string[]> = {
  modern:    ['modern', 'clean', 'minimal', 'contemporary', 'fresh', 'sleek', 'simple'],
  classic:   ['traditional', 'established', 'trusted', 'heritage', 'conservative', 'professional', 'formal'],
  editorial: ['editorial', 'thoughtful', 'considered', 'refined', 'sophisticated', 'intelligent'],
  warm:      ['warm', 'approachable', 'friendly', 'personable', 'welcoming', 'human', 'caring'],
}

const TIE_PRIORITY: TypePairingFeel[] = ['modern', 'classic', 'editorial', 'warm']
const NO_SIGNAL_FALLBACK_ID = 'civic-modern'

function combineBrandText(brand: SessionSchema['brand'] | undefined): string {
  if (!brand) return ''
  const parts: string[] = []
  if (Array.isArray(brand.toneAdjectives)) parts.push(brand.toneAdjectives.join(' '))
  if (brand.brandPersonality) parts.push(brand.brandPersonality)
  if (brand.aspirationalTone) parts.push(brand.aspirationalTone)
  return parts.join(' ').toLowerCase()
}

function scoreFeel(text: string, keywords: string[]): number {
  let score = 0
  for (const kw of keywords) {
    const re = new RegExp(`\\b${kw}\\b`, 'i')
    if (re.test(text)) score++
  }
  return score
}

function pickFeel(text: string): { feel: TypePairingFeel; hasWarmSignal: boolean; anySignal: boolean } {
  const scores: Record<TypePairingFeel, number> = {
    modern: scoreFeel(text, FEEL_KEYWORDS.modern),
    classic: scoreFeel(text, FEEL_KEYWORDS.classic),
    editorial: scoreFeel(text, FEEL_KEYWORDS.editorial),
    warm: scoreFeel(text, FEEL_KEYWORDS.warm),
  }
  const anySignal = Object.values(scores).some(s => s > 0)
  const hasWarmSignal = scores.warm > 0

  let winner: TypePairingFeel = TIE_PRIORITY[0]
  let max = -1
  for (const feel of TIE_PRIORITY) {
    if (scores[feel] > max) {
      max = scores[feel]
      winner = feel
    }
  }
  return { feel: winner, hasWarmSignal, anySignal }
}

function pickRoundness(typographyFeel: TypePairingFeel, hasWarmSignal: boolean): Roundness {
  if (typographyFeel === 'classic') return 'sharp'
  if (hasWarmSignal) return 'soft'
  return 'soft'
}

function pickDensity(hasWarmSignal: boolean): Density {
  return hasWarmSignal ? 'airy' : 'balanced'
}

function pickVisualFeel(typographyFeel: TypePairingFeel): VisualFeel {
  if (typographyFeel === 'warm') return 'modern'
  return typographyFeel
}

export function suggestDesignTokens(
  brand: SessionSchema['brand'] | undefined,
  palette: PaletteData | null
): DesignTokens {
  void palette // reserved for future palette-derived heuristics; intentionally unused for now
  void chroma  // imported so future heuristics can use chroma; intentionally unused for now

  const text = combineBrandText(brand)
  const { feel, hasWarmSignal, anySignal } = pickFeel(text)

  const pairingId = anySignal
    ? (TYPE_PAIRINGS.find(p => p.feel === feel)?.id ?? NO_SIGNAL_FALLBACK_ID)
    : NO_SIGNAL_FALLBACK_ID
  const pairing = findPairing(pairingId)!

  return {
    typePairing: {
      id: pairing.id,
      headingFont: pairing.headingFont,
      bodyFont: pairing.bodyFont,
      label: pairing.label,
      accentFont: pairing.accentFont,
    },
    roundness: pickRoundness(feel, hasWarmSignal),
    density: pickDensity(hasWarmSignal),
    visualFeel: pickVisualFeel(feel),
  }
}
