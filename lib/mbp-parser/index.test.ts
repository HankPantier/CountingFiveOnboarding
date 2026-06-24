import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMBP } from './index'

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
