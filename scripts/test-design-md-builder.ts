import { buildDesignMd } from '../lib/content/design-md-builder'
import type { PaletteData } from '../types/palette'
import type { DesignTokens } from '../types/design-tokens'
import type { SessionSchema } from '../types/session-schema'

let passed = 0
let failed = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('✓ ' + label); passed++ }
  else { console.log('✗ ' + label + (detail ? ': ' + detail : '')); failed++ }
}

const palette: PaletteData = {
  primary:        { hex: '#003B71', name: 'Navy' },
  secondary:      { hex: '#6C7278', name: 'Slate' },
  complementary:  { hex: '#B8422E', name: 'Terracotta' },
  action:         { hex: '#00C1DE', name: 'Cyan' },
  nearBlack:      { hex: '#1A1C1E', name: 'Near Black' },
  nearWhite:      { hex: '#F7F5F2', name: 'Near White' },
}

const tokens: DesignTokens = {
  typePairing: { id: 'civic-modern', headingFont: 'Public Sans', bodyFont: 'Public Sans', label: 'Civic Modern' },
  roundness: 'pill',
  density: 'balanced',
  visualFeel: 'modern',
}

const brand: SessionSchema['brand'] = {
  currentTone: '', aspirationalTone: 'measured and trustworthy',
  toneAdjectives: ['clean', 'modern'],
  toneToAvoid: ['leverage', 'synergy', 'world-class'],
  voiceExample: '', brandPersonality: 'plain-spoken',
  primaryColors: '', typography: '', logoStyle: '', hasBrandGuide: false,
}

const out = buildDesignMd({
  firmName: 'Acme PLLP',
  palette, tokens, brand,
  business: { name: 'Acme PLLP', foundingYear: '1972' } as SessionSchema['business'],
  location: { city: 'Boston', state: 'MA' },
})

// YAML structure
assert('front-matter delimiters present', out.startsWith('<!-- Fonts:') && out.includes('\n---\n'), 'first 200 chars: ' + out.slice(0, 200))
assert('name field correct', out.includes('name: "Acme PLLP"'))
assert('primary color from palette', out.includes('primary: "#003B71"'))
assert('action color from palette', out.includes('action: "#00C1DE"'))
assert('pill value = 9999px when roundness=pill', /pill:\s*"9999px"/.test(out))
assert('xl spacing = 48px when density=balanced', /xl:\s*"48px"/.test(out))
assert('on-action present', /on-action:\s*"#/.test(out))
assert('heading font is Public Sans', out.includes('fontFamily: "Public Sans"'))

// Canonical section order
const sectionIdx = (h: string) => out.indexOf('## ' + h)
const order = ['Overview', 'Colors', 'Typography', 'Layout', 'Elevation & Depth', 'Shapes', 'Components', "Do's and Don'ts"]
for (let i = 0; i < order.length; i++) {
  assert(`section "${order[i]}" present`, sectionIdx(order[i]) > -1, 'idx=' + sectionIdx(order[i]))
}
for (let i = 1; i < order.length; i++) {
  assert(`"${order[i]}" appears after "${order[i-1]}"`, sectionIdx(order[i]) > sectionIdx(order[i-1]))
}

// Body interpolation
assert('Overview mentions firm + city', out.includes('Acme PLLP in Boston, MA'))
assert('Overview mentions aspirational tone', out.includes('measured and trustworthy'))
assert('Overview mentions personality', out.includes('plain-spoken'))

// Do's/Don'ts
assert("avoid list present in Don't section", out.includes('avoid list:') && out.includes('"leverage"'))

// Pill-value variants
const sharp = buildDesignMd({
  firmName: 'X', palette,
  tokens: { ...tokens, roundness: 'sharp' },
  brand, business: undefined, location: null,
})
assert('roundness=sharp → pill: "4px"', /pill:\s*"4px"/.test(sharp))

const soft = buildDesignMd({
  firmName: 'X', palette,
  tokens: { ...tokens, roundness: 'soft' },
  brand, business: undefined, location: null,
})
assert('roundness=soft → pill: "8px"', /pill:\s*"8px"/.test(soft))

// Density variants
const tight = buildDesignMd({
  firmName: 'X', palette,
  tokens: { ...tokens, density: 'tight' },
  brand, business: undefined, location: null,
})
assert('density=tight → xl: "32px"', /xl:\s*"32px"/.test(tight))

const airy = buildDesignMd({
  firmName: 'X', palette,
  tokens: { ...tokens, density: 'airy' },
  brand, business: undefined, location: null,
})
assert('density=airy → 2xl: "128px"', /2xl:\s*"128px"/.test(airy))

// Empty brand → no avoid line
const emptyBrand = buildDesignMd({
  firmName: 'X', palette, tokens,
  brand: undefined, business: undefined, location: null,
})
assert('no avoid list when brand undefined', !emptyBrand.includes('avoid list:'))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
