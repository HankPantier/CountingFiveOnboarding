import { describe, it, expect } from 'vitest'
import { pickPostSlug } from './resource-draft-generator'

describe('pickPostSlug', () => {
  it('reuses the idea slug on a re-draft even though the index lists it (no slug-2 duplicate)', () => {
    // Regression: the cross-link index contains this idea's OWN post, so the old
    // collision loop always minted `<slug>-2` and left the original behind.
    expect(
      pickPostSlug({
        title: 'Year End Tax Planning',
        ideaId: 'abcdef12-0000',
        existingSlug: 'year-end-tax-planning',
        takenSlugs: ['year-end-tax-planning', 'other-post'],
      })
    ).toBe('year-end-tax-planning')
  })

  it('dodges other posts on a first draft', () => {
    expect(
      pickPostSlug({ title: 'Year End Tax Planning', ideaId: 'abcdef12', existingSlug: null, takenSlugs: ['year-end-tax-planning'] })
    ).toBe('year-end-tax-planning-2')
  })

  it('falls back to an id-derived slug for an unsluggable title', () => {
    expect(pickPostSlug({ title: '!!!', ideaId: 'abcdef1234', existingSlug: null, takenSlugs: [] })).toBe('post-abcdef12')
  })
})
