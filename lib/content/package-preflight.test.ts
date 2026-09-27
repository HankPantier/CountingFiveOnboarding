import { describe, expect, it } from 'vitest'
import { findPlaceholderRefs, placeholderRefsMessage } from './package-preflight'

const page = (filename: string, content: string) => ({ filename, content })

describe('findPlaceholderRefs', () => {
  it('flags the template placeholder hero (Slachta home.md)', () => {
    const refs = findPlaceholderRefs([
      page('home.md', '---\ntitle: "Home"\nhero_image: hero-office.png\n---\n\nBody'),
      page('about.md', '---\nhero_image: "/content-assets/team-photo.png"\n---\n'),
    ])
    expect(refs).toEqual([
      { page: 'home.md', ref: 'hero-office.png' },
      { page: 'about.md', ref: 'team-photo.png' },
    ])
  })

  it('flags images with an empty source', () => {
    expect(findPlaceholderRefs([page('a.md', 'Text ![Team]() more')])).toEqual([
      { page: 'a.md', ref: '(image with an empty src)' },
    ])
    expect(findPlaceholderRefs([page('b.md', '<img alt="x" src="">')])).toHaveLength(1)
  })

  it('ignores real images and look-alike names', () => {
    expect(
      findPlaceholderRefs([
        page('c.md', 'hero_image: pexels-123-hero-office.png.webp\n![Office](/content-assets/our-hero-office.png)\n<img src="/a.png">'),
      ]),
    ).toEqual([])
  })

  it('builds an actionable message naming the pages', () => {
    const msg = placeholderRefsMessage([{ page: 'home.md', ref: 'hero-office.png' }])
    expect(msg).toMatch(/home\.md → hero-office\.png/)
    expect(msg).toMatch(/Re-pull images/)
  })
})
