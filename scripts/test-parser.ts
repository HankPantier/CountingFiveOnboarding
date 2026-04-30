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

// T2
const tier1Gaps = gaps.filter(g => g.tier === 1)
assert('T2 — Tier 1 gap count is 9', tier1Gaps.length === 9, 'got: ' + tier1Gaps.length)

// T3
const titleGaps = gaps.filter(g => g.field.includes('.title'))
assert('T3 — Title gaps exist', titleGaps.length > 0, 'got: ' + titleGaps.length)
console.log('     Title gaps:', titleGaps.map(g => g.label).join(', '))

// T4
const { schema: emptySchema, gaps: emptyGaps } = parseMFP('')
assert('T4 — Empty MFP does not throw', true)
assert('T4 — Empty MFP has Phase 4 gaps', emptyGaps.filter(g => g.tier === 1).length === 9, 'got: ' + emptyGaps.filter(g => g.tier === 1).length)

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
