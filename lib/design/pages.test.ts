import { describe, it, expect } from 'vitest'
import { pickRepresentativePages } from './pages'

const TREE = [
  'content/pages/home.md',
  'content/pages/services.md',
  'content/pages/services--tax-planning.md',
  'content/pages/services--bookkeeping.md',
  'content/pages/who-we-are.md',
  'content/pages/contact-us.md',
  'content/pages/industries--construction.md',
  'content/drafts/pages/secret.md',
  'content/posts/some-post.md',
  'content/brand.json',
]

describe('pickRepresentativePages', () => {
  it('picks home, a deep service page, about and contact in that order', () => {
    const r = pickRepresentativePages(TREE)
    expect(r.picks).toEqual([
      { key: 'home', path: '/' },
      { key: 'service', path: '/services/bookkeeping' },
      { key: 'about', path: '/who-we-are' },
      { key: 'contact', path: '/contact-us' },
    ])
  })

  it('lists only live pages, sorted, excluding drafts and posts', () => {
    expect(pickRepresentativePages(TREE).pages).toEqual([
      '/',
      '/contact-us',
      '/industries/construction',
      '/services',
      '/services/bookkeeping',
      '/services/tax-planning',
      '/who-we-are',
    ])
  })

  it('falls back to /services and skips missing roles', () => {
    const r = pickRepresentativePages(['content/pages/home.md', 'content/pages/services.md'])
    expect(r.picks).toEqual([
      { key: 'home', path: '/' },
      { key: 'service', path: '/services' },
    ])
  })

  it('always includes home even when the tree lacks it', () => {
    expect(pickRepresentativePages([]).picks).toEqual([{ key: 'home', path: '/' }])
  })

  it('matches about-style pages: about, about-us, team, our-team', () => {
    for (const slug of ['about', 'about-us', 'team', 'our-team', 'our-firm']) {
      const r = pickRepresentativePages([`content/pages/${slug}.md`])
      expect(r.picks.find((p) => p.key === 'about')?.path).toBe(`/${slug}`)
    }
  })

  it('offers the block specimen last when the site supports it', () => {
    const paths = ['content/pages/home.md', 'content/pages/contact.md']
    expect(pickRepresentativePages(paths).picks.map((p) => p.key)).not.toContain('specimen')
    const { picks, pages } = pickRepresentativePages(paths, { specimen: true })
    expect(picks.at(-1)).toEqual({ key: 'specimen', path: '/design-specimen' })
    expect(pages).not.toContain('/design-specimen')
  })
})
