import type { DesignBundle } from '../bundle'

export const VALID: DesignBundle = {
  schemaVersion: 1,
  name: 'Harbor Ledger',
  tagline: 'Calm authority with a warm serif voice',
  rationale: 'The MBP asks for trustworthy, modern, never stuffy.',
  moves: ['Serif statement headlines', 'Ink footer band'],
  palette: {
    primary: '#003b71',
    secondary: '#e8eef5',
    complementary: '#c46a2b',
    action: '#00c1de',
    nearBlack: '#101820',
    nearWhite: '#fafaf7',
  },
  typography: { headingFont: 'Public Sans', bodyFont: 'Public Sans', accentFont: 'Fraunces' },
  tokens: {
    roundness: 'soft',
    density: 'balanced',
    visualFeel: 'editorial',
    spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '48px', '2xl': '96px' },
    radius: { none: '0px', sm: '4px', md: '8px', lg: '16px', pill: '9999px' },
  },
  treatments: { headlineStyle: 'serif', eyebrowStyle: 'mono', darkSections: true },
  css: { blocks: { hero: '[data-block="hero"] h1 { letter-spacing: -0.02em; }' } },
  meta: { source: 'concept', model: 'claude-opus-5-5' },
}
