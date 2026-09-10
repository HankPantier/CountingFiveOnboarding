import { describe, expect, it } from 'vitest'
import { isLikelyHeadshot, rankCandidatesForMember, type HeadshotCandidate } from './match'

function candidate(overrides: Partial<HeadshotCandidate> = {}): HeadshotCandidate {
  return {
    imageUrl: 'https://example.com/img.jpg',
    altText: null,
    nearbyName: null,
    filename: 'img.jpg',
    width: null,
    height: null,
    sourcePageUrl: 'https://example.com/team/jane-doe',
    ...overrides,
  }
}

describe('isLikelyHeadshot', () => {
  it('rejects site chrome, banners, maps, and social glyphs by filename', () => {
    for (const filename of ['logo.png', 'hero-banner.jpg', 'google-map.png', 'facebook.svg', 'sponsor-strip.png']) {
      expect(isLikelyHeadshot(candidate({ filename, sourcePageUrl: 'https://example.com/' }))).toBe(false)
    }
  })

  it('rejects banner/strip aspect ratios and tiny images when dimensions are declared', () => {
    // Wide banner even on a team page.
    expect(isLikelyHeadshot(candidate({ filename: 'photo.jpg', width: 1600, height: 400 }))).toBe(false)
    // Icon-sized thumbnail.
    expect(isLikelyHeadshot(candidate({ filename: 'photo.jpg', width: 50, height: 50 }))).toBe(false)
  })

  it('drops generic off-team-page images with no person signal', () => {
    expect(
      isLikelyHeadshot(candidate({ filename: 'post-image.jpg', sourcePageUrl: 'https://example.com/blog/tax-tips' })),
    ).toBe(false)
  })

  it('keeps a square portrait on a bio page', () => {
    expect(
      isLikelyHeadshot(candidate({ filename: 'jane.jpg', width: 400, height: 400 })),
    ).toBe(true)
  })

  it('keeps a team-page image whose alt names a person, even without dimensions', () => {
    expect(
      isLikelyHeadshot(
        candidate({ filename: 'DSC_1234.jpg', altText: 'Jane Doe', sourcePageUrl: 'https://example.com/our-team' }),
      ),
    ).toBe(true)
  })

  it('keeps a person-hinted image even off a team page (homepage headshot)', () => {
    expect(
      isLikelyHeadshot(candidate({ filename: 'staff-headshot.jpg', sourcePageUrl: 'https://example.com/' })),
    ).toBe(true)
  })
})

describe('rankCandidatesForMember', () => {
  const bioPortrait = candidate({
    imageUrl: 'https://example.com/a.jpg',
    filename: 'portrait.jpg',
    width: 400,
    height: 400,
    sourcePageUrl: 'https://example.com/team/jane-doe',
  })
  const teamFullName = candidate({
    imageUrl: 'https://example.com/b.jpg',
    filename: 'b.jpg',
    altText: 'Jane Doe',
    sourcePageUrl: 'https://example.com/team',
  })
  const teamFirstNameOnly = candidate({
    imageUrl: 'https://example.com/e.jpg',
    filename: 'e.jpg',
    altText: 'Jane',
    sourcePageUrl: 'https://example.com/team',
  })
  const teamOtherPerson = candidate({
    imageUrl: 'https://example.com/c.jpg',
    filename: 'c.jpg',
    altText: 'John Smith',
    sourcePageUrl: 'https://example.com/team',
  })
  const logo = candidate({
    imageUrl: 'https://example.com/logo.jpg',
    filename: 'logo.jpg',
    sourcePageUrl: 'https://example.com/',
  })

  it('ranks the member bio-page portrait first', () => {
    const ranked = rankCandidatesForMember({ name: 'Jane Doe' }, [teamOtherPerson, teamFullName, bioPortrait])
    expect(ranked[0]).toBe(bioPortrait)
  })

  it('orders by name-token overlap and puts unrelated headshots last', () => {
    const ranked = rankCandidatesForMember({ name: 'Jane Doe' }, [teamOtherPerson, teamFirstNameOnly, teamFullName])
    expect(ranked.map((c) => c.imageUrl)).toEqual([teamFullName.imageUrl, teamFirstNameOnly.imageUrl, teamOtherPerson.imageUrl])
  })

  it('drops non-headshots (logos) from the result entirely', () => {
    const ranked = rankCandidatesForMember({ name: 'Jane Doe' }, [logo, bioPortrait])
    expect(ranked).not.toContainEqual(logo)
    expect(ranked).toContain(bioPortrait)
  })
})
