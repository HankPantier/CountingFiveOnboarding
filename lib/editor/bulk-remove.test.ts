import { describe, expect, it } from 'vitest'
import { applyBulkRemovals, countPhrase } from './bulk-remove'

const PAGE = `---
title: Root Advisors brings 40 years of expertise
meta_title: Root Advisors — 40 years of tax help
meta_description: Led by Jared Hammack, CPA, Root Advisors serves you.
secondary_keywords: [root advisors, tax planning, 40 years]
---
# Welcome

Root Advisors has 40 years of experience — led by Jared Hammack, CPA.

<!-- block: content-split | variant: image-right | image: x.jpg | alt: "Root Advisors — team" -->
## Our team

We keep dashes here inside code:

\`\`\`
const note = "kept — verbatim"
\`\`\`

Rooms run 600–1200 sq ft.
`

describe('applyBulkRemovals', () => {
  it('removes every occurrence of a phrase across frontmatter and body in one pass', () => {
    const res = applyBulkRemovals(PAGE, [{ find: '40 years' }])
    expect(res.applied).toEqual([{ find: '40 years', removed: 4 }])
    expect(res.next).not.toContain('40 years')
    expect(res.residual).toEqual([])
    // frontmatter SEO fields are cleaned too
    expect(res.next).toContain('meta_title: Root Advisors —  of tax help')
  })

  it('replaces with a provided value instead of deleting', () => {
    const res = applyBulkRemovals(PAGE, [{ find: 'Root Advisors', replace: 'the firm' }])
    expect(res.next).not.toContain('Root Advisors')
    expect(res.next).toContain('the firm has 40 years')
    expect(res.applied[0].removed).toBeGreaterThan(0)
  })

  it('is case-insensitive when asked (catches keyword-array casing)', () => {
    // "root advisors" (lowercase) only appears in the keyword array.
    const sensitive = applyBulkRemovals(PAGE, [{ find: 'root advisors' }])
    expect(sensitive.applied[0].removed).toBe(1)

    const insensitive = applyBulkRemovals(PAGE, [{ find: 'root advisors' }], { caseInsensitive: true })
    expect(insensitive.next.toLowerCase()).not.toContain('root advisors')
    expect(insensitive.residual).toEqual([])
  })

  it('fully deletes an exact phrase from frontmatter and body with no residual', () => {
    const res = applyBulkRemovals(PAGE, [{ find: 'Jared Hammack, CPA' }])
    expect(res.residual).toEqual([])
    expect(res.next).not.toContain('Jared Hammack, CPA')
  })

  it('reports a residual when the phrase is still present after the pass (replacement reintroduced it)', () => {
    const res = applyBulkRemovals('The old brand Root Advisors LLC.', [
      { find: 'Root Advisors', replace: 'Root Advisors Group' },
    ])
    expect(res.applied).toEqual([{ find: 'Root Advisors', removed: 1 }])
    expect(res.residual).toEqual([{ find: 'Root Advisors', remaining: 1 }])
    expect(res.next).toBe('The old brand Root Advisors Group LLC.')
  })

  it('strips em/en dashes page-wide, protecting code fences and keeping numeric ranges', () => {
    const res = applyBulkRemovals(PAGE, [], { stripDashes: true })
    expect(res.dashesStripped).toBeGreaterThan(0)
    // em-dash in prose becomes a comma
    expect(res.next).toContain('40 years of experience, led by')
    // dash inside the fenced code block is preserved
    expect(res.next).toContain('const note = "kept — verbatim"')
    // block annotation is preserved verbatim
    expect(res.next).toContain('alt: "Root Advisors — team"')
    // numeric en-dash range preserved
    expect(res.next).toContain('600–1200 sq ft')
  })

  it('records 0 removed for a phrase not present without inventing residuals', () => {
    const res = applyBulkRemovals(PAGE, [{ find: 'Acme LLC' }])
    expect(res.applied).toEqual([{ find: 'Acme LLC', removed: 0 }])
    expect(res.residual).toEqual([])
    expect(res.next).toBe(PAGE)
  })
})

describe('countPhrase', () => {
  it('counts literal occurrences case-sensitively by default', () => {
    expect(countPhrase('a A a A', 'a')).toBe(2)
  })
  it('counts case-insensitively when asked', () => {
    expect(countPhrase('a A a A', 'a', true)).toBe(4)
  })
  it('escapes regex metacharacters in the phrase', () => {
    expect(countPhrase('cost is $40 (net) $40', '$40 (net)', true)).toBe(1)
  })
  it('returns 0 for an empty phrase', () => {
    expect(countPhrase('anything', '')).toBe(0)
  })
})
