import { describe, expect, it } from 'vitest'
import { buildMbpDocument, mbpDocumentToMarkdown } from '@/lib/mbp/build-document'
import { generateMbpPdf } from './generate-mbp-pdf'
import type { SessionSchema } from '@/types/session-schema'

const schema: SessionSchema = {
  websiteUrl: 'https://acme.example',
  contact: { firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.example', phone: '555' },
  business: {
    name: 'Acme Accounting', tagline: 'Tax & advisory', positioningOption: '', positioningStatement: '',
    foundingYear: '2005', firmHistory: 'Founded by Jane.', idealClients: ['contractors'], geographicScope: 'TX',
    clientAgeRanges: [], customerNeeds: '', customerDescription: 'SMBs', differentiators: 'Niche depth',
    affiliations: [], clientSuccessStories: [], clientMixBreakdown: '', howClientsFind: '', pricing: '', growthGoals: '',
  },
  team: [{ name: 'Jane Doe', title: 'Partner', certifications: ['CPA'], bio: 'Veteran CPA.', specializations: [] }],
  services: [{ name: 'Tax Planning', description: 'Year-round strategy', offerings: ['prep'] }],
}

describe('MBP deliverable rendering', () => {
  it('renders the MbpDocument to a real PDF buffer', async () => {
    const doc = buildMbpDocument(schema)
    const buf = await generateMbpPdf(doc, schema as Record<string, unknown>, null)
    expect(buf.length).toBeGreaterThan(1000)
    // PDF magic bytes
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('renders the MbpDocument to markdown with the canonical heading', () => {
    const md = mbpDocumentToMarkdown(buildMbpDocument(schema))
    expect(md.startsWith('# Master Business Profile')).toBe(true)
    expect(md).toContain('Acme Accounting')
    expect(md).toContain('## Business')
  })
})
