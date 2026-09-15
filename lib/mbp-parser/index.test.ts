import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMBP, computePhase4Gaps } from './index'
import type { SessionSchema } from '@/types/session-schema'

// The Korbey Lague MBP is the canonical handoff fixture: an analyst-authored
// document that an admin uploads to create a session (app/api/sessions/parse).
// These tests guard that parsing it yields exactly what onboarding needs —
// complete schema, clean field boundaries, and the right gap list.
const fixture = readFileSync(
  join(process.cwd(), 'raw-docs/mfp-korbeylague-com-2026-04-24.md'),
  'utf-8',
)
const { schema, gaps } = parseMBP(fixture)

describe('parseMBP — Korbey Lague handoff completeness', () => {
  it('extracts the firm identity', () => {
    expect(schema.websiteUrl).toBe('https://www.korbeylague.com')
    expect(schema.business?.name).toBe('Korbey Lague PLLP')
    expect(schema.business?.formerName).toContain('Murphy')
    expect(schema.locations).toHaveLength(1)
  })

  it('extracts the full team, services, and niches with ICPs', () => {
    expect(schema.team).toHaveLength(9)
    expect(schema.services?.length).toBeGreaterThanOrEqual(10)
    expect(schema.niches?.length).toBeGreaterThanOrEqual(5)
    expect(schema.niches?.every((n) => !!n.icp)).toBe(true)
  })

  it('extracts reputation, content gaps, and both sitemaps', () => {
    expect(schema.reputation?.trustSignalGaps?.length).toBeGreaterThan(0)
    expect(schema.content_gaps?.nicheGaps?.length).toBeGreaterThan(0)
    expect(schema.current_sitemap?.length).toBeGreaterThan(0)
    expect(schema.proposed_sitemap?.length).toBeGreaterThan(0)
  })

  it('captures analyst review prompts into _meta', () => {
    expect(Object.keys(schema._meta?.review_prompts ?? {}).length).toBeGreaterThan(0)
    expect(schema._meta?.before_you_review_checklist?.length).toBeGreaterThan(0)
  })
})

describe('parseMBP — field boundaries are clean (no over-capture)', () => {
  it('positioningStatement holds the three options only — not the table or prompts', () => {
    const ps = schema.business?.positioningStatement ?? ''
    expect(ps).toContain('Option A')
    expect(ps).toContain('Option B')
    expect(ps).toContain('Option C')
    // Must NOT bleed into the trailing Competitive Context table or the
    // analyst's review-action prompt that follow the options in Section 2.
    expect(ps).not.toContain('Competitive Context')
    expect(ps).not.toContain('Client Review Action')
    expect(ps).not.toContain('| Firm |')
    expect(ps).not.toContain('Key Competitive Takeaways')
  })

  it('competitive context is parsed into its own fields', () => {
    expect(schema.business?.competitors?.length).toBeGreaterThanOrEqual(5)
    expect(schema.business?.competitiveContext).toBeTruthy()
  })

  it('GBP hint is a single line — it does not absorb the next field', () => {
    const hint = schema.business?.googleBusinessProfile?.roomForImprovement ?? ''
    expect(hint).not.toContain('Review Summary')
    expect(hint).not.toMatch(/\n/)
  })
})

describe('parseMBP — non-MBP input is recognized as nothing', () => {
  it('matches no Section 1–11 structure in a wrong-format doc', () => {
    // The admin MBP *export* (build-document.ts) is a flat "## Business / -
    // **Name:**" format with no "## Section N" headers — the parser recognizes
    // none of it, so /api/sessions/parse rejects it (422) instead of creating a
    // junk session. A real MBP always carries a firm name + URL in Section 1.
    const { schema } = parseMBP('# Master Business Profile\n\n## Business\n- **Name:** Acme CPA\n\n## Team\n### Jane Doe\n- **Title:** Partner\n')
    expect(schema.business?.name ?? '').toBe('')
    expect(schema.websiteUrl ?? '').toBe('')
    expect(schema.team?.length ?? 0).toBe(0)
    expect(schema.services?.length ?? 0).toBe(0)
  })
})

describe('parseMBP — gap list is what Phase 4 needs', () => {
  it('seeds the brand block (incl. personality + typography) and unanswered business gaps', () => {
    const fields = new Set(gaps.map((g) => g.field))
    for (const f of [
      'brand.currentTone',
      'brand.primaryColors',
      'brand.brandPersonality',
      'brand.typography',
      'business.foundingYear',
      'culture.missionVisionValues',
    ]) {
      expect(fields.has(f)).toBe(true)
    }
  })

  it('seeds a gap for every team member missing a title', () => {
    const titleGaps = gaps.filter((g) => /^team\[\d+\]\.title$/.test(g.field))
    const missingTitles = (schema.team ?? []).filter((t) => !t.title).length
    expect(titleGaps).toHaveLength(missingTitles)
  })

  it('does not seed gaps for fields the MBP already filled', () => {
    const fields = new Set(gaps.map((g) => g.field))
    expect(fields.has('business.firmHistory')).toBe(false) // parsed from Section 2
    expect(fields.has('business.name')).toBe(false)
  })
})

describe('computePhase4Gaps — content-generation-critical capture', () => {
  const byField = (s: SessionSchema) => new Map(computePhase4Gaps(s).map((g) => [g.field, g]))

  it('seeds content-scope gaps (emphasis + exclusions) at Tier 2', () => {
    const m = byField({ business: {} } as SessionSchema)
    expect(m.get('business.contentEmphasis')?.tier).toBe(2)
    expect(m.get('business.contentExclusions')?.tier).toBe(2)
  })

  it('promotes client success stories and the voice sample to Tier 1', () => {
    const m = byField({} as SessionSchema)
    expect(m.get('business.clientSuccessStories')?.tier).toBe(1)
    expect(m.get('brand.voiceExample')?.tier).toBe(1)
  })

  it('seeds per-niche audience-depth gaps at the documented tiers', () => {
    const m = byField({
      niches: [{ name: 'Dental', description: '', icp: '', painPoints: '', valueProp: '' }],
    } as SessionSchema)
    expect(m.get('niches[0].customerTrigger')?.tier).toBe(1)
    expect(m.get('niches[0].valueProp')?.tier).toBe(1)
    expect(m.get('niches[0].keywords')?.tier).toBe(2)
    expect(m.get('niches[0].decisionMaker')?.tier).toBe(2)
    expect(m.get('niches[0].businessStage')?.tier).toBe(3)
    expect(m.get('niches[0].revenueBand')?.tier).toBe(3)
  })

  it('suppresses per-niche depth gaps the schema already fills', () => {
    const fields = new Set(
      computePhase4Gaps({
        niches: [{
          name: 'Dental', description: '', icp: '', painPoints: 'x', valueProp: 'y',
          customerTrigger: 'z', keywords: ['a'], decisionMaker: 'owner', businessStage: 'mature', revenueBand: '$1M',
        }],
      } as SessionSchema).map((g) => g.field),
    )
    for (const f of [
      'niches[0].customerTrigger', 'niches[0].valueProp', 'niches[0].keywords',
      'niches[0].decisionMaker', 'niches[0].businessStage', 'niches[0].revenueBand',
    ]) {
      expect(fields.has(f)).toBe(false)
    }
  })

  it('suppresses content-scope gaps when the MBP supplies them', () => {
    const fields = new Set(
      computePhase4Gaps({
        business: { contentEmphasis: ['nonprofits'], contentExclusions: ['crypto'] },
      } as SessionSchema).map((g) => g.field),
    )
    expect(fields.has('business.contentEmphasis')).toBe(false)
    expect(fields.has('business.contentExclusions')).toBe(false)
  })
})

describe('computePhase4Gaps — dropped niches', () => {
  const withNiches = (): SessionSchema =>
    ({
      niches: [
        { name: 'Dental', description: '', icp: '', painPoints: '', valueProp: '' },
        { name: 'Legal', description: '', icp: '', painPoints: '', valueProp: '', status: 'dropped' },
        { name: 'Nonprofit', description: '', icp: '', painPoints: '', valueProp: '' },
      ],
    } as SessionSchema)

  it('emits no gaps for a dropped niche but keeps kept niches at their original index', () => {
    const fields = new Set(computePhase4Gaps(withNiches()).map((g) => g.field))
    expect(fields.has('niches[1].painPoints')).toBe(false) // Legal is dropped
    expect(fields.has('niches[0].painPoints')).toBe(true) // Dental keeps index 0
    expect(fields.has('niches[2].painPoints')).toBe(true) // Nonprofit keeps index 2
  })
})
