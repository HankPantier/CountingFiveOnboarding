import { buildBrandJson } from '../lib/content/brand-json-builder'
import { buildDesignJson } from '../lib/content/design-json-builder'
import { buildNavJson } from '../lib/content/nav-json-builder'
import type { SessionSchema } from '../types/session-schema'
import type { PaletteData } from '../types/palette'
import type { DesignTokens } from '../types/design-tokens'
import type { SitemapEntry } from '../lib/content/nav-json-builder'

let passed = 0
let failed = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('✓ ' + label); passed++ }
  else { console.log('✗ ' + label + (detail ? ': ' + detail : '')); failed++ }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const schemaFixture: SessionSchema = {
  business: {
    name: 'Korbey Lague PLLP',
    tagline: 'CPAs you can talk to',
    foundingYear: '1972',
    firmHistory: '',
    positioningStatement: '', positioningOption: '',
    idealClients: [], geographicScope: '', clientAgeRanges: [],
    customerNeeds: '', customerDescription: '', differentiators: '',
    affiliations: ['AICPA', 'Massachusetts Society of CPAs'],
    clientSuccessStories: [], clientMixBreakdown: '', howClientsFind: '',
    pricing: '', growthGoals: '',
  },
  locations: [{
    name: 'Main Office', street: '123 Main St', line2: '', city: 'Boston', state: 'MA', zip: '02101',
    phone: '555-1234', fax: '', email: 'info@example.com',
    hours: { Mon: '9–5', Tue: '9–5' },
  }],
  culture: {
    missionVisionValues: '', teamDescription: '',
    socialMediaChannels: ['https://facebook.com/firm', 'https://twitter.com/firm'],
    linkedIn: { url: 'https://linkedin.com/company/firm', usefulness: 'medium', roomForImprovement: '' },
  },
  assets: {
    headshotsAvailable: [], officePhotosAvailable: false, testimonialsAvailable: [],
    logosUploaded: ['logo.png'], photosUploaded: [],
  },
}

const paletteFixture: PaletteData = {
  primary: { hex: '#003B71', name: 'Navy' },
  secondary: { hex: '#6C7278', name: 'Slate' },
  complementary: { hex: '#B8422E', name: 'Terracotta' },
  action: { hex: '#00C1DE', name: 'Cyan' },
  nearBlack: { hex: '#1A1C1E', name: 'Near Black' },
  nearWhite: { hex: '#F7F5F2', name: 'Near White' },
}

const tokensFixture: DesignTokens = {
  typePairing: { id: 'civic-modern', headingFont: 'Public Sans', bodyFont: 'Public Sans', label: 'Civic Modern' },
  roundness: 'pill',
  density: 'balanced',
  visualFeel: 'modern',
}

const sitemapFixture: SitemapEntry[] = [
  { url: '/', title: 'Home', status: 'new' },
  { url: '/services', title: 'Services', status: 'new' },
  { url: '/services/tax', title: 'Tax', status: 'new', parent: '/services' },
  { url: '/services/audit', title: 'Audit', status: 'new', parent: '/services' },
  { url: '/about', title: 'About', status: 'new' },
  { url: '/old-page', title: 'Old Page', status: 'redirect' },
]

// ---------------------------------------------------------------------------
// Test: buildBrandJson
// ---------------------------------------------------------------------------

console.log('\n--- brand-json builder ---')
const brandJson = buildBrandJson(schemaFixture, paletteFixture)

assert('firm.name === "Korbey Lague PLLP"', brandJson.firm.name === 'Korbey Lague PLLP', brandJson.firm.name)
assert('firm.tagline === "CPAs you can talk to"', brandJson.firm.tagline === 'CPAs you can talk to', brandJson.firm.tagline)
assert('firm.foundingYear === "1972"', brandJson.firm.foundingYear === '1972', brandJson.firm.foundingYear)
assert('contact.address?.city === "Boston"', brandJson.contact.address?.city === 'Boston', brandJson.contact.address?.city)
assert('contact.phone === "555-1234"', brandJson.contact.phone === '555-1234', brandJson.contact.phone)
assert('contact.hours?.Mon === "9–5"', brandJson.contact.hours?.Mon === '9–5', brandJson.contact.hours?.Mon)
assert('palette.primary === "#003B71"', brandJson.palette.primary === '#003B71', brandJson.palette.primary)
assert('palette.action === "#00C1DE"', brandJson.palette.action === '#00C1DE', brandJson.palette.action)
assert('social.length === 3', brandJson.social.length === 3, String(brandJson.social.length))
assert('social.some(s => s.platform === "linkedin")', brandJson.social.some(s => s.platform === 'linkedin'))
assert('social.some(s => s.platform === "facebook")', brandJson.social.some(s => s.platform === 'facebook'))
assert('certifications.length === 2', brandJson.certifications.length === 2, String(brandJson.certifications.length))
assert('certifications[0].alt === "AICPA"', brandJson.certifications[0]?.alt === 'AICPA', brandJson.certifications[0]?.alt)
assert('logo.primary === "logo.png"', brandJson.logo.primary === 'logo.png', brandJson.logo.primary)
assert('logo.alt === "Korbey Lague PLLP logo"', brandJson.logo.alt === 'Korbey Lague PLLP logo', brandJson.logo.alt)

// ---------------------------------------------------------------------------
// Test: buildDesignJson
// ---------------------------------------------------------------------------

console.log('\n--- design-json builder ---')
const designJson = buildDesignJson(tokensFixture)

assert('typography.headingFont === "Public Sans"', designJson.typography.headingFont === 'Public Sans', designJson.typography.headingFont)
assert('typography.bodyFont === "Public Sans"', designJson.typography.bodyFont === 'Public Sans', designJson.typography.bodyFont)
assert('typography.googleFontsUrl.includes("Public+Sans")', designJson.typography.googleFontsUrl.includes('Public+Sans'), designJson.typography.googleFontsUrl)
assert('roundness === "pill"', designJson.roundness === 'pill', designJson.roundness)
assert('density === "balanced"', designJson.density === 'balanced', designJson.density)
assert('radius.pill === "9999px"', designJson.radius.pill === '9999px', designJson.radius.pill)
assert('spacing.xl === "48px"', designJson.spacing.xl === '48px', designJson.spacing.xl)
assert('spacing["2xl"] === "96px"', designJson.spacing['2xl'] === '96px', designJson.spacing['2xl'])

// ---------------------------------------------------------------------------
// Test: buildNavJson
// ---------------------------------------------------------------------------

console.log('\n--- nav-json builder ---')
const navJson = buildNavJson(sitemapFixture)

assert('primary.length === 2', navJson.primary.length === 2, String(navJson.primary.length))
assert('primary[0].label === "Services"', navJson.primary[0]?.label === 'Services', navJson.primary[0]?.label)
assert('primary[0].children?.length === 2', navJson.primary[0]?.children?.length === 2, String(navJson.primary[0]?.children?.length))
assert('primary[0].children?.[0].label === "Tax"', navJson.primary[0]?.children?.[0]?.label === 'Tax', navJson.primary[0]?.children?.[0]?.label)
assert('primary[1].label === "About"', navJson.primary[1]?.label === 'About', navJson.primary[1]?.label)
assert('cta === undefined', navJson.cta === undefined, String(navJson.cta))

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
