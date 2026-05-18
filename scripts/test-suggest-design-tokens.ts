import { suggestDesignTokens } from '../lib/content/suggest-design-tokens'
import type { SessionSchema } from '../types/session-schema'

let passed = 0
let failed = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('✓ ' + label); passed++ }
  else { console.log('✗ ' + label + (detail ? ': ' + detail : '')); failed++ }
}

const empty: SessionSchema['brand'] = {
  currentTone: '', aspirationalTone: '', toneAdjectives: [], toneToAvoid: [],
  voiceExample: '', brandPersonality: '',
  primaryColors: '', typography: '', logoStyle: '', hasBrandGuide: false,
}

// 1. No signal → civic-modern / soft / balanced / modern
const r1 = suggestDesignTokens(empty, null)
assert('no signal: pairing id is civic-modern', r1.typePairing.id === 'civic-modern', r1.typePairing.id)
assert('no signal: roundness=soft', r1.roundness === 'soft', r1.roundness)
assert('no signal: density=balanced', r1.density === 'balanced', r1.density)
assert('no signal: visualFeel=modern', r1.visualFeel === 'modern', r1.visualFeel)

// 2. Modern signal
const modernBrand = { ...empty, toneAdjectives: ['clean', 'modern'], aspirationalTone: 'minimal' }
const r2 = suggestDesignTokens(modernBrand, null)
assert('modern signal: pairing feel is modern', r2.typePairing.id === 'modern-sans', r2.typePairing.id)
assert('modern signal: visualFeel=modern', r2.visualFeel === 'modern', r2.visualFeel)

// 3. Classic signal
const classicBrand = { ...empty, toneAdjectives: ['traditional', 'established'], brandPersonality: 'trusted' }
const r3 = suggestDesignTokens(classicBrand, null)
assert('classic signal: pairing feel is classic', r3.typePairing.id === 'heritage', r3.typePairing.id)
assert('classic signal: roundness=sharp', r3.roundness === 'sharp', r3.roundness)
assert('classic signal: visualFeel=classic', r3.visualFeel === 'classic', r3.visualFeel)

// 4. Editorial signal
const editorialBrand = { ...empty, toneAdjectives: ['thoughtful', 'refined'] }
const r4 = suggestDesignTokens(editorialBrand, null)
assert('editorial signal: pairing feel is editorial', r4.typePairing.id === 'classic-editorial', r4.typePairing.id)
assert('editorial signal: visualFeel=editorial', r4.visualFeel === 'editorial', r4.visualFeel)

// 5. Warm signal
const warmBrand = { ...empty, toneAdjectives: ['warm', 'approachable'], brandPersonality: 'friendly' }
const r5 = suggestDesignTokens(warmBrand, null)
assert('warm signal: pairing feel is warm', r5.typePairing.id === 'warm-approachable', r5.typePairing.id)
assert('warm signal: roundness=soft', r5.roundness === 'soft', r5.roundness)
assert('warm signal: density=airy', r5.density === 'airy', r5.density)
assert('warm signal: visualFeel=modern (warm maps to modern)', r5.visualFeel === 'modern', r5.visualFeel)

// 6. Tie-break: modern beats classic when scores equal
const tieBrand = { ...empty, toneAdjectives: ['modern', 'traditional'] }
const r6 = suggestDesignTokens(tieBrand, null)
assert('tie: modern wins over classic', r6.typePairing.id === 'modern-sans', r6.typePairing.id)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
