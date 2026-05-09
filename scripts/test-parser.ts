import { parseMFP } from '../lib/mfp-parser/index'
import * as fs from 'fs'
import * as path from 'path'

const mfpPath = path.join(__dirname, '../raw-docs/mfp-korbeylague-com-2026-04-24.md')
const mfp = fs.readFileSync(mfpPath, 'utf-8')
const { schema, gaps } = parseMFP(mfp)

let passed = 0
let failed = 0

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log('✓ ' + label)
    passed++
  } else {
    console.log('✗ ' + label + (detail ? ': ' + detail : ''))
    failed++
  }
}

// T1
assert('T1 — Business name parsed', schema.business?.name === 'Korbey Lague PLLP', 'got: ' + schema.business?.name)
assert('T1 — Website URL parsed', schema.websiteUrl?.includes('korbeylague.com') ?? false, 'got: ' + schema.websiteUrl)
assert('T1 — Location count > 0', (schema.locations?.length ?? 0) > 0, 'got: ' + schema.locations?.length)
assert('T1 — Team count > 0', (schema.team?.length ?? 0) > 0, 'got: ' + schema.team?.length)
assert('T1 — Services count > 0', (schema.services?.length ?? 0) > 0, 'got: ' + schema.services?.length)
assert('T1 — Gap count > 0', gaps.length > 0, 'got: ' + gaps.length)

// T2 — 16 base tier-1 gaps + 1 per niche (pain points)
const tier1Gaps = gaps.filter(g => g.tier === 1)
const expectedTier1 = 16 + (schema.niches?.length ?? 0)
assert('T2 — Tier 1 gap count is ' + expectedTier1, tier1Gaps.length === expectedTier1, 'got: ' + tier1Gaps.length)

// T3
const titleGaps = gaps.filter(g => g.field.includes('.title'))
assert('T3 — Title gaps exist', titleGaps.length > 0, 'got: ' + titleGaps.length)
console.log('     Title gaps:', titleGaps.map(g => g.label).join(', '))

// T4
const { schema: emptySchema, gaps: emptyGaps } = parseMFP('')
assert('T4 — Empty MFP does not throw', true)
assert('T4 — Empty MFP has 16 base Phase 4 tier-1 gaps', emptyGaps.filter(g => g.tier === 1).length === 16, 'got: ' + emptyGaps.filter(g => g.tier === 1).length)

// T5
const { schema: partialSchema } = parseMFP('## Section 1 — Firm Identity\n| **Firm Name** | Test Co |\n')
assert('T5 — Partial MFP does not throw', true)
assert('T5 — Partial MFP parses firm name', partialSchema.business?.name === 'Test Co', 'got: ' + partialSchema.business?.name)

// T6
const confirmedAffiliations = schema.business?.affiliations ?? []
const affiliationGaps = gaps.filter(g => g.field.includes('affiliations'))
assert('T6 — Confirmed affiliations exist', confirmedAffiliations.length > 0, 'got: ' + confirmedAffiliations.length)
assert('T6 — No overlap between affiliations and gaps',
  confirmedAffiliations.every(a => !affiliationGaps.some(g => g.field.includes(a))),
  'overlap detected'
)

// T7 — Section 8: Reputation & Trust Signals
assert('T7 — reputation.trustSignalGaps is non-empty', (schema.reputation?.trustSignalGaps?.length ?? 0) > 0, 'got: ' + schema.reputation?.trustSignalGaps?.length)
assert('T7 — reputation.pressAndMedia exists', Array.isArray(schema.reputation?.pressAndMedia), 'not an array')

// T8 — Section 9: Content Gap Analysis
assert('T8 — content_gaps.nicheGaps is non-empty', (schema.content_gaps?.nicheGaps?.length ?? 0) > 0, 'got: ' + schema.content_gaps?.nicheGaps?.length)
assert('T8 — content_gaps.authorityGaps is non-empty', (schema.content_gaps?.authorityGaps?.length ?? 0) > 0, 'got: ' + schema.content_gaps?.authorityGaps?.length)
assert('T8 — content_gaps.conversionGaps is non-empty', (schema.content_gaps?.conversionGaps?.length ?? 0) > 0, 'got: ' + schema.content_gaps?.conversionGaps?.length)
assert('T8 — content_gaps.teamExpertiseGaps is non-empty', (schema.content_gaps?.teamExpertiseGaps?.length ?? 0) > 0, 'got: ' + schema.content_gaps?.teamExpertiseGaps?.length)

// T9 — Section 10A: Current Site Map
assert('T9 — current_sitemap is non-empty', (schema.current_sitemap?.length ?? 0) > 0, 'got: ' + schema.current_sitemap?.length)
const redirectRows = schema.current_sitemap?.filter(r => r.action === 'redirect') ?? []
assert('T9 — current_sitemap has redirect rows', redirectRows.length > 0, 'got: ' + redirectRows.length)
const newPageRows = schema.current_sitemap?.filter(r => r.action === 'new') ?? []
assert('T9 — current_sitemap has new page rows', newPageRows.length > 0, 'got: ' + newPageRows.length)

// T10 — Section 10B: Proposed Site Map
assert('T10 — proposed_sitemap is non-empty', (schema.proposed_sitemap?.length ?? 0) > 0, 'got: ' + schema.proposed_sitemap?.length)
const newPages = schema.proposed_sitemap?.filter(p => p.status === 'new') ?? []
const updatePages = schema.proposed_sitemap?.filter(p => p.status === 'update') ?? []
const existingPages = schema.proposed_sitemap?.filter(p => p.status === 'existing') ?? []
assert('T10 — proposed_sitemap has new pages', newPages.length > 0, 'got: ' + newPages.length)
assert('T10 — proposed_sitemap has update pages', updatePages.length > 0, 'got: ' + updatePages.length)
assert('T10 — proposed_sitemap has existing pages', existingPages.length > 0, 'got: ' + existingPages.length)
assert('T10 — proposed_sitemap pages have parent refs', schema.proposed_sitemap!.some(p => p.parent !== undefined), 'no parents found')

// T11 — Section 4: structured LinkedIn + Google Business Profile capture
// Korbey fixture has ❓ for LinkedIn URL and prose-only "not directly confirmed" for GBP,
// so both should land as { url: null } with corresponding Phase-3 gaps.
assert('T11 — culture.linkedIn defined', schema.culture?.linkedIn !== undefined)
assert('T11 — culture.linkedIn.url is null (unconfirmed)', schema.culture?.linkedIn?.url === null, 'got: ' + JSON.stringify(schema.culture?.linkedIn?.url))
assert('T11 — business.googleBusinessProfile defined', schema.business?.googleBusinessProfile !== undefined)
assert('T11 — business.googleBusinessProfile.url is null (unconfirmed)', schema.business?.googleBusinessProfile?.url === null, 'got: ' + JSON.stringify(schema.business?.googleBusinessProfile?.url))
assert('T11 — gap list includes LinkedIn URL (phase 3)', gaps.some(g => g.field === 'culture.linkedIn.url' && g.phase === 3))
assert('T11 — gap list includes GBP URL (phase 3)', gaps.some(g => g.field === 'business.googleBusinessProfile.url' && g.phase === 3))
assert('T11 — no legacy technical.googleBusinessProfileUrl gap', !gaps.some(g => g.field === 'technical.googleBusinessProfileUrl'))

console.log('\n--- Summary ---')
console.log('Passed: ' + passed + ' / Failed: ' + failed)
console.log('\nSchema snapshot:')
console.log('  business.name:', schema.business?.name)
console.log('  websiteUrl:', schema.websiteUrl)
console.log('  locations:', schema.locations?.length, schema.locations?.[0]?.city)
console.log('  team:', schema.team?.length, schema.team?.map(t => t.name).join(', '))
console.log('  services:', schema.services?.length)
console.log('  niches:', schema.niches?.length, schema.niches?.map(n => n.name).join(', '))
console.log('  affiliations:', schema.business?.affiliations)
console.log('  socialMedia:', schema.culture?.socialMediaChannels)
console.log('  tagline:', schema.business?.tagline)
console.log('  positioning options:', schema.business?.positioningStatement?.split('---').length)
console.log('\nGaps by phase:')
console.log('  Phase 3:', gaps.filter(g => g.phase === 3).map(g => g.label).join(', '))
console.log('  Phase 4 T1:', gaps.filter(g => g.phase === 4 && g.tier === 1).map(g => g.label).join(', '))
console.log('  Phase 4 T2:', gaps.filter(g => g.phase === 4 && g.tier === 2).map(g => g.label).join(', '))
console.log('  Phase 4 T3:', gaps.filter(g => g.phase === 4 && g.tier === 3).map(g => g.label).join(', '))

if (failed > 0) process.exit(1)
