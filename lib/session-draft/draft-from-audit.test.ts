import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditResult } from '@/types/audit-result'

vi.mock('@/lib/mbp/generate-json', () => ({ generateMbpJson: vi.fn() }))
// proposeSitemap is exercised by its own test; here we mock it so the draft test
// asserts the wiring (its return is assigned to schema.proposed_sitemap) without
// triggering the proposer's own AI call.
vi.mock('@/lib/content/sitemap-proposer', () => ({ proposeSitemap: vi.fn() }))
import { generateMbpJson } from '@/lib/mbp/generate-json'
import { proposeSitemap } from '@/lib/content/sitemap-proposer'
import { draftSessionFromAudit, validateDraftModel } from './draft-from-audit'

const mockGen = vi.mocked(generateMbpJson)
const mockPropose = vi.mocked(proposeSitemap)

const longText = (label: string) => `${label}. ` + 'Acme provides tax planning, bookkeeping, and advisory services to small businesses across Texas. '.repeat(20)

function auditResult(over: Partial<AuditResult> = {}): AuditResult {
  return {
    version: '1.0',
    domain: 'acme.example',
    site_name: 'Acme',
    url: 'https://acme.example',
    audit_date: '2026-06-12',
    max_pages: 50,
    pages_crawled: 6,
    crawl_errors_count: 0,
    overall_score: 50,
    overall_grade: 'F',
    scores: {} as AuditResult['scores'],
    category_scores: {} as AuditResult['category_scores'],
    findings: {} as AuditResult['findings'],
    recommendations: [],
    page_analysis_summary: [
      { url: 'https://acme.example/', status_code: 200, title: 'Home', title_ok: true, title_len: 4, meta_desc: '', meta_ok: false, meta_len: 0, h1_count: 1, h1_text: 'Welcome', schema_types: [], word_count: 400, og_complete: false, has_ga4: false, issues: [], content_snippet: 'Acme provides tax help.', suggested_title: null, suggested_meta: null },
      { url: 'https://acme.example/services', status_code: 200, title: 'Services', title_ok: true, title_len: 8, meta_desc: '', meta_ok: false, meta_len: 0, h1_count: 1, h1_text: 'Services', schema_types: [], word_count: 400, og_complete: false, has_ga4: false, issues: [], content_snippet: 'Bookkeeping and tax.', suggested_title: null, suggested_meta: null },
    ],
    google_indexed_urls: [],
    sitemap: {} as AuditResult['sitemap'],
    business_signals: {
      organizationName: 'Acme Accounting',
      phones: ['+1 (555) 123-4567'],
      emails: ['hello@acme.example'],
      addresses: ['100 Main St, Austin, TX'],
      socialLinks: ['https://linkedin.com/company/acme'],
    },
    raw: {
      pages: [],
      analyzed: [{ page_text_sample: longText('Home') }, { page_text_sample: longText('Services') }],
      psi_mobile: {},
      psi_desktop: {},
      robots: {},
      ssl: {},
      llms: {},
      crawl_errors: [],
    } as unknown as AuditResult['raw'],
    ...over,
  }
}

// A clean, already-validated DraftModel (what generateMbpJson resolves to).
const MODEL = {
  business: {
    name: 'Acme Accounting',
    tagline: 'Tax & advisory for small business',
    customerDescription: 'Small businesses across Texas.',
    differentiators: 'Industry-specific expertise.',
    idealClients: ['contractors', 'restaurants'],
  },
  services: [{ name: 'Tax Planning', description: 'Year-round tax strategy.', offerings: ['prep'] }],
  niches: [{ name: 'Construction', description: 'Contractors.' }],
  locations: [{ name: 'Main', street: '100 Main St', city: 'Austin', state: 'TX', zip: '78701', phone: '555', email: 'a@b.com' }],
  team: [{ name: 'Jane Doe', title: 'Partner', bio: 'CPA with 20 years.' }],
  culture: { socialMediaChannels: ['https://twitter.com/acme'] },
  brand: { currentTone: 'professional', toneAdjectives: ['clear'] },
}

describe('validateDraftModel (coercion)', () => {
  it('coerces types and drops malformed entries', () => {
    const out = validateDraftModel({
      business: { name: 'Acme', idealClients: ['a', 2, 'b'], tagline: 5 },
      services: [{ name: 'Good', description: 'x', offerings: ['o'] }, { name: 123 }],
      niches: 'nope',
      team: [{ name: 'Jane', title: 'P', bio: 'b' }],
    })
    expect(out).not.toBeNull()
    expect(out!.business?.name).toBe('Acme')
    expect(out!.business?.tagline).toBe('') // non-string coerced to ''
    expect(out!.business?.idealClients).toEqual(['a', 'b']) // non-strings dropped
    expect(out!.niches).toEqual([]) // non-array coerced to []
  })

  it('returns null for non-objects', () => {
    expect(validateDraftModel(null)).toBeNull()
    expect(validateDraftModel('x')).toBeNull()
  })

  it('captures detected pricing and drops empty tier entries', () => {
    const out = validateDraftModel({
      business: { name: 'Acme' },
      pricing: {
        pageUrl: 'https://acme.example/pricing',
        strategy: 'tiers',
        tiers: [{ name: 'Starter', price: '$299/mo', features: ['Bookkeeping'] }, { name: '' }],
        rates: [{ service: 'Payroll', rate: '$99/mo' }],
      },
    })
    expect(out!.pricing?.strategy).toBe('tiers')
    expect(out!.pricing?.tiers).toEqual([{ name: 'Starter', price: '$299/mo', features: ['Bookkeeping'] }])
    expect(out!.pricing?.rates).toEqual([{ service: 'Payroll', rate: '$99/mo' }])
  })

  it('omits pricing entirely when nothing usable was found', () => {
    const out = validateDraftModel({ business: { name: 'Acme' }, pricing: { strategy: 'bogus', tiers: [] } })
    expect(out!.pricing).toBeUndefined()
  })
})

describe('draftSessionFromAudit', () => {
  beforeEach(() => {
    mockGen.mockReset()
    mockPropose.mockReset()
    mockPropose.mockResolvedValue([])
  })

  it('maps a model into a valid SessionSchema, merges signals, computes gaps', async () => {
    mockGen.mockResolvedValue(MODEL)
    mockPropose.mockResolvedValue([
      { url: 'https://acme.example/', title: 'Home', status: 'update' },
      { url: '/industries/construction', title: 'Construction', status: 'new', parent: '/industries', notes: 'Contractor focus.' },
    ])
    const { schema, gaps, contact, coverage } = await draftSessionFromAudit(auditResult())

    expect(schema.business?.name).toBe('Acme Accounting')
    expect(schema.business?.idealClients).toEqual(['contractors', 'restaurants'])
    expect(schema.services).toHaveLength(1)
    expect(schema.niches?.[0]).toMatchObject({ name: 'Construction', icp: '', painPoints: '', valueProp: '' })
    expect(schema.locations?.[0]).toMatchObject({ name: 'Main', city: 'Austin', fax: '' })
    expect(schema.team?.[0]).toMatchObject({ name: 'Jane Doe', certifications: [] })
    expect(schema.culture?.socialMediaChannels).toContain('https://twitter.com/acme')
    expect(schema.culture?.socialMediaChannels).toContain('https://linkedin.com/company/acme')
    expect(schema.websiteUrl).toBe('https://acme.example')

    expect(contact).toEqual({ phone: '+1 (555) 123-4567', email: 'hello@acme.example' })
    expect(gaps.some((g) => g.field === 'business.foundingYear')).toBe(true)
    expect(gaps.some((g) => g.field === 'niches[0].painPoints')).toBe(true)

    expect(coverage.thin).toBe(false)
    expect(coverage.populatedFields).toBeGreaterThanOrEqual(6)

    // current_sitemap + content_gaps are the deterministic audit-crawl plan;
    // proposed_sitemap is assigned from the (mocked) AI proposer.
    expect(schema.current_sitemap?.length).toBe(2)
    expect(mockPropose).toHaveBeenCalled()
    expect(schema.proposed_sitemap?.length).toBe(2)
    expect(schema.proposed_sitemap?.[0].status).toBe('update')
    expect(schema.content_gaps).toBeDefined()
    expect(coverage.contentPlan.pagesFound).toBe(2)
  })

  it('carries audit intelligence into the seed (rewriteDirection + _meta.audit_context)', async () => {
    mockGen.mockResolvedValue(MODEL)
    const withIntel = auditResult({
      intelligence: {
        niche_services: {
          detected_niches: [], invisible_niches: [], top_improvements: [],
          services_analysis: [
            { service: 'Tax Planning', clarity: '', framing: '', audience: '', rewrite_direction: 'Lead with proactive strategy.' },
          ],
        },
        tech_stack: { cms: 'WordPress', page_builder: null, hosting: 'WP Engine', frameworks: [], risk_flags: [], commentary: '' },
        domain: { registered: '2008-04-01', age_years: 18, last_updated: null },
      } as unknown as AuditResult['intelligence'],
    })
    const { schema } = await draftSessionFromAudit(withIntel)
    expect(schema.services?.find((s) => s.name === 'Tax Planning')?.rewriteDirection).toBe('Lead with proactive strategy.')
    expect(schema.technical?.hostingProvider).toBe('WP Engine')
    expect(schema._meta?.audit_context?.techStack?.cms).toBe('WordPress')
    expect(schema._meta?.audit_context?.domain?.ageYears).toBe(18)
  })

  it('degrades gracefully when the AI draft fails (null)', async () => {
    mockGen.mockResolvedValue(null)
    const { schema, gaps, coverage } = await draftSessionFromAudit(auditResult())
    expect(schema.business?.name).toBe('Acme Accounting') // falls back to signal org name
    expect(schema.services).toEqual([])
    expect(gaps.length).toBeGreaterThan(0)
    expect(coverage.thin).toBe(true)
    expect(coverage.reasons).toContain('the AI draft could not be generated')
  })

  it('flags thin data for a sparse audit with no signals', async () => {
    mockGen.mockResolvedValue({})
    const sparse = auditResult({
      pages_crawled: 1,
      business_signals: undefined,
      page_analysis_summary: [
        { url: 'https://x.example/', status_code: 200, title: 'X', title_ok: true, title_len: 1, meta_desc: '', meta_ok: false, meta_len: 0, h1_count: 0, h1_text: '', schema_types: [], word_count: 5, og_complete: false, has_ga4: false, issues: [], content_snippet: 'hi', suggested_title: null, suggested_meta: null },
      ],
      raw: undefined,
    })
    const { coverage } = await draftSessionFromAudit(sparse)
    expect(coverage.thin).toBe(true)
    expect(coverage.hadBusinessSignals).toBe(false)
    expect(coverage.reasons).toContain('only a few pages were crawled')
  })
})
