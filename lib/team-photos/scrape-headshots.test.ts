import { describe, expect, it } from 'vitest'
import {
  findTeamPages,
  findBioPages,
  looksLikeTeamPageUrl,
  extractHeadshotCandidates,
  matchHeadshotsToMembers,
  suggestCandidatesByName,
} from './scrape-headshots'

const PAGE = 'https://example.com/about'

describe('findTeamPages', () => {
  const html = `
    <a href="/about/team">Our Team</a>
    <a href="/leadership">Leadership</a>
    <a href="/services">Services</a>
    <a href="https://twitter.com/acme/team">Social team</a>
    <a href="/meet-the-partners">Meet the partners</a>
    <a href="mailto:hi@example.com">Email us</a>
    <a href="/blog">Read our blog about the team</a>
  `

  it('keeps same-domain links whose href or text signals a team/about page', () => {
    const urls = findTeamPages(html, 'https://example.com/')
    expect(urls).toContain('https://example.com/about/team')
    expect(urls).toContain('https://example.com/leadership')
    expect(urls).toContain('https://example.com/meet-the-partners')
    // Matched by link text ("about the team"), same domain.
    expect(urls).toContain('https://example.com/blog')
  })

  it('drops off-domain, mailto, and unrelated links', () => {
    const urls = findTeamPages(html, 'https://example.com/')
    expect(urls).not.toContain('https://twitter.com/acme/team')
    expect(urls.some((u) => u.startsWith('mailto:'))).toBe(false)
    expect(urls).not.toContain('https://example.com/services')
  })

  it('recognizes common About synonyms like "who-we-are" and "our-firm"', () => {
    const synonyms = `
      <a href="/who-we-are">Who We Are</a>
      <a href="/our-firm">Our Firm</a>
      <a href="/professionals">Professionals</a>
      <a href="/what-we-do">What We Do</a>
    `
    const urls = findTeamPages(synonyms, 'https://example.com/')
    expect(urls).toContain('https://example.com/who-we-are')
    expect(urls).toContain('https://example.com/our-firm')
    expect(urls).toContain('https://example.com/professionals')
    // Services/offerings pages are not team pages.
    expect(urls).not.toContain('https://example.com/what-we-do')
  })
})

describe('looksLikeTeamPageUrl', () => {
  it('matches team/about-page URL paths and rejects unrelated ones', () => {
    expect(looksLikeTeamPageUrl('https://x.com/who-we-are')).toBe(true)
    expect(looksLikeTeamPageUrl('https://x.com/about/team')).toBe(true)
    expect(looksLikeTeamPageUrl('https://x.com/our-firm')).toBe(true)
    expect(looksLikeTeamPageUrl('https://x.com/professionals')).toBe(true)
    expect(looksLikeTeamPageUrl('https://x.com/what-we-do')).toBe(false)
    expect(looksLikeTeamPageUrl('https://x.com/resources/quick-reads')).toBe(false)
  })
})

describe('extractHeadshotCandidates', () => {
  it('absolutizes src, captures alt + nearby name, skips logos/icons', () => {
    const html = `
      <img src="/img/logo.png" alt="Acme logo" />
      <figure>
        <img src="../uploads/ron-lague.jpg" alt="Ron Lague, CPA" />
        <figcaption>Ron Lague</figcaption>
      </figure>
      <img src="https://cdn.example.com/icons/star.svg" alt="star" />
    `
    const candidates = extractHeadshotCandidates(html, PAGE)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      imageUrl: 'https://example.com/uploads/ron-lague.jpg',
      altText: 'Ron Lague, CPA',
      nearbyName: 'Ron Lague',
      filename: 'ron-lague.jpg',
    })
  })

  it('resolves srcset to the largest entry', () => {
    const html = `<img srcset="/s/small.jpg 320w, /s/large.jpg 1024w" alt="Jane" />`
    const candidates = extractHeadshotCandidates(html, PAGE)
    expect(candidates[0].imageUrl).toBe('https://example.com/s/large.jpg')
  })

  it('skips tiny declared dimensions and data URIs', () => {
    const html = `
      <img src="/pixel.gif" width="1" height="1" alt="" />
      <img src="data:image/png;base64,AAAA" alt="inline" />
      <img src="/team/dana.jpg" width="400" height="400" alt="Dana" />
    `
    const candidates = extractHeadshotCandidates(html, PAGE)
    expect(candidates.map((c) => c.filename)).toEqual(['dana.jpg'])
  })

  it('falls back to the nearest heading when there is no figcaption', () => {
    const html = `
      <div class="card">
        <h3>Sam Park</h3>
        <div><img src="/team/sam.jpg" alt="" /></div>
      </div>
    `
    expect(extractHeadshotCandidates(html, PAGE)[0].nearbyName).toBe('Sam Park')
  })

  it('records the page the image was found on', () => {
    const html = `<img src="/team/dana.jpg" width="400" height="400" alt="Dana" />`
    expect(extractHeadshotCandidates(html, PAGE)[0].sourcePageUrl).toBe(PAGE)
  })
})

describe('findBioPages', () => {
  it('keeps same-domain links exactly one segment below the team page', () => {
    const html = `
      <a href="/who-we-are/jane-doe">Jane Doe</a>
      <a href="/who-we-are/john-smith">John Smith</a>
      <a href="/who-we-are/jane-doe/resume.pdf">Résumé</a>
      <a href="/who-we-are/team/extra">Too deep</a>
      <a href="/contact">Contact</a>
      <a href="https://other.example/who-we-are/x">Off domain</a>
    `
    const urls = findBioPages(html, 'https://acme.example/who-we-are')
    expect(urls).toContain('https://acme.example/who-we-are/jane-doe')
    expect(urls).toContain('https://acme.example/who-we-are/john-smith')
    expect(urls).not.toContain('https://acme.example/who-we-are/jane-doe/resume.pdf')
    expect(urls).not.toContain('https://acme.example/who-we-are/team/extra')
    expect(urls).not.toContain('https://acme.example/contact')
    expect(urls.some((u) => u.startsWith('https://other.example'))).toBe(false)
  })

  it('returns nothing for a root/homepage team URL', () => {
    expect(findBioPages('<a href="/about/x">x</a>', 'https://acme.example/')).toEqual([])
  })
})

describe('matchHeadshotsToMembers', () => {
  it('marks a bio-page image (slug matches name) as high confidence', () => {
    // Only the bio-page slug names the person — the image alt/filename do not.
    const candidates = extractHeadshotCandidates(
      `<img src="/portrait.jpg" width="400" height="400" alt="Team member portrait" />`,
      'https://acme.example/team/dana-wells',
    )
    const out = matchHeadshotsToMembers([{ name: 'Dana Wells, CPA' }], candidates)
    expect(out[0]).toEqual({
      name: 'Dana Wells, CPA',
      imageUrl: 'https://acme.example/portrait.jpg',
      confidence: 'high',
    })
  })

  it('marks a two-token text overlap on a team grid as high confidence', () => {
    const candidates = extractHeadshotCandidates(
      `<figure><img src="/img/ron-lague.jpg" alt="Ron Lague, CPA" /><figcaption>Ron Lague</figcaption></figure>`,
      'https://acme.example/about',
    )
    const out = matchHeadshotsToMembers([{ name: 'Ron Lague, CPA, PFS' }], candidates)
    expect(out[0].confidence).toBe('high')
    expect(out[0].imageUrl).toBe('https://acme.example/img/ron-lague.jpg')
  })

  it('marks a single-token overlap as low confidence', () => {
    const candidates = extractHeadshotCandidates(
      `<figure><img src="/img/photo.jpg" alt="Dana at the office" /><figcaption>Dana</figcaption></figure>`,
      'https://acme.example/about',
    )
    const out = matchHeadshotsToMembers([{ name: 'Dana Wells' }], candidates)
    expect(out[0].confidence).toBe('low')
    expect(out[0].imageUrl).toBe('https://acme.example/img/photo.jpg')
  })

  it('returns none with a null image when nothing overlaps', () => {
    const candidates = extractHeadshotCandidates(
      `<figure><img src="/img/ron.jpg" alt="Ron Lague" /><figcaption>Ron Lague</figcaption></figure>`,
      'https://acme.example/about',
    )
    const out = matchHeadshotsToMembers([{ name: 'Wilhelmina Nobody' }], candidates)
    expect(out[0]).toEqual({ name: 'Wilhelmina Nobody', imageUrl: null, confidence: 'none' })
  })
})

describe('suggestCandidatesByName', () => {
  const candidates = extractHeadshotCandidates(
    `
      <figure><img src="/team/ron-lague.jpg" alt="Ron Lague, CPA" /><figcaption>Ron Lague</figcaption></figure>
      <figure><img src="/team/jackie-estes.jpg" alt="Jackie Estes" /><figcaption>Jackie Estes</figcaption></figure>
    `,
    PAGE
  )

  it('matches members to the best-overlapping candidate', () => {
    const out = suggestCandidatesByName(
      [{ name: 'Ron Lague, CPA, PFS' }, { name: 'Jackie Estes, MBA' }],
      candidates
    )
    expect(out['Ron Lague, CPA, PFS']).toBe('https://example.com/team/ron-lague.jpg')
    expect(out['Jackie Estes, MBA']).toBe('https://example.com/team/jackie-estes.jpg')
  })

  it('returns null when no candidate overlaps the name', () => {
    const out = suggestCandidatesByName([{ name: 'Wilhelmina Nobody' }], candidates)
    expect(out['Wilhelmina Nobody']).toBeNull()
  })
})
