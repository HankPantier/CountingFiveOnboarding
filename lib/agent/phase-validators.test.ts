import { describe, expect, it } from 'vitest'
import { validatePhaseAdvance } from './phase-validators'
import type { GapItem } from '@/types/gap-item'

const gap = (over: Partial<GapItem> = {}): GapItem =>
  ({ field: 'x', label: 'x', phase: 4, tier: 1, resolved: false, ...over })

describe('validatePhaseAdvance — phase 1 → 2', () => {
  const full = { contact: { email: 'a@b.co', firstName: 'A', phone: '555' }, websiteUrl: 'x.com' }

  it('passes when contact + websiteUrl are all present', () => {
    expect(validatePhaseAdvance(1, full, [])).toBeNull()
  })

  it.each([
    ['email', { ...full, contact: { ...full.contact, email: '' } }],
    ['firstName', { ...full, contact: { ...full.contact, firstName: '' } }],
    ['phone', { ...full, contact: { ...full.contact, phone: '' } }],
    ['websiteUrl', { ...full, websiteUrl: '' }],
  ])('blocks when %s is missing', (_field, schema) => {
    expect(validatePhaseAdvance(1, schema, [])).not.toBeNull()
  })
})

describe('validatePhaseAdvance — phase 2 never advances via the tool', () => {
  it('always blocks', () => {
    expect(validatePhaseAdvance(2, {}, [])).toMatch(/automatically after WHOIS/)
  })
})

describe('validatePhaseAdvance — phase 3 → 4 chunk gate', () => {
  const captured = {
    culture: { linkedIn: { url: null } },
    business: { googleBusinessProfile: { url: null } },
  }

  it('blocks until chunk1 present', () => {
    expect(validatePhaseAdvance(3, { ...captured, _meta: { phase3_completed_chunks: [] } }, []))
      .toMatch(/chunk1/)
  })

  it('blocks when chunk2a/2b missing', () => {
    expect(
      validatePhaseAdvance(3, { ...captured, _meta: { phase3_completed_chunks: ['chunk1'] } }, [])
    ).toMatch(/chunk2a/)
  })

  // A geo_review marker is now an unconditional Phase-3 gate, so the "passes"
  // cases must carry one.
  const geoDone = { geo_review: { reviewedAt: 'x', scope: 'national', areaCount: 0 } }

  it('passes with chunk1 + chunk2a + chunk2b and both profiles captured', () => {
    const schema = {
      ...captured,
      _meta: { phase3_completed_chunks: ['chunk1', 'chunk2a', 'chunk2b'], ...geoDone },
    }
    expect(validatePhaseAdvance(3, schema, [])).toBeNull()
  })

  it('accepts the legacy single "chunk2" marker in place of 2a/2b', () => {
    const schema = { ...captured, _meta: { phase3_completed_chunks: ['chunk1', 'chunk2'], ...geoDone } }
    expect(validatePhaseAdvance(3, schema, [])).toBeNull()
  })

  it('requires a usefulness rating once a real profile URL exists', () => {
    const schema = {
      _meta: { phase3_completed_chunks: ['chunk1', 'chunk2'] },
      culture: { linkedIn: { url: 'https://linkedin.com/x' } },
      business: { googleBusinessProfile: { url: null } },
    }
    expect(validatePhaseAdvance(3, schema, [])).toMatch(/linkedIn\.usefulness/)
  })

  it('blocks until the services review is submitted when services exist', () => {
    const schema = {
      ...captured,
      services: [{ name: 'Bookkeeping' }],
      _meta: { phase3_completed_chunks: ['chunk1', 'chunk2'], ...geoDone },
    }
    expect(validatePhaseAdvance(3, schema, [])).toMatch(/services keep\/drop review/)
  })

  it('does not require a services review when there are no services', () => {
    const schema = {
      ...captured,
      _meta: { phase3_completed_chunks: ['chunk1', 'chunk2'], ...geoDone },
    }
    expect(validatePhaseAdvance(3, schema, [])).toBeNull()
  })

  it('blocks unconditionally until the geo review is submitted', () => {
    const schema = { ...captured, _meta: { phase3_completed_chunks: ['chunk1', 'chunk2'] } }
    expect(validatePhaseAdvance(3, schema, [])).toMatch(/geographic scope review/)
  })

  it('passes with services + geo reviews submitted', () => {
    const schema = {
      ...captured,
      services: [{ name: 'Bookkeeping' }],
      _meta: {
        phase3_completed_chunks: ['chunk1', 'chunk2'],
        services_review: { reviewedAt: 'x', kept: ['Bookkeeping'], dropped: [], added: [] },
        ...geoDone,
      },
    }
    expect(validatePhaseAdvance(3, schema, [])).toBeNull()
  })
})

describe('validatePhaseAdvance — phase 4 → 5 tier-1 gaps', () => {
  it('blocks while any tier-1 gap is unresolved', () => {
    expect(validatePhaseAdvance(4, {}, [gap({ tier: 1, resolved: false })])).toMatch(/Tier 1/)
  })

  it('passes when all tier-1 gaps are resolved (tier-2 may remain)', () => {
    const gaps = [gap({ tier: 1, resolved: true }), gap({ tier: 2, resolved: false })]
    expect(validatePhaseAdvance(4, {}, gaps)).toBeNull()
  })
})
