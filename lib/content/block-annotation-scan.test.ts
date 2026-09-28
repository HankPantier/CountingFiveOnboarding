import { describe, expect, it } from 'vitest'
import { scanPageFile, summarizeScans } from './block-annotation-scan'

const PAGE = `---
title: Contact
hero: "hero"
hero_variant: image-left
---
<!-- block: intro-text | variant: centered -->
## Hi

Text.

<!-- block: process-steps | variant: horizontal -->

<!-- block: industry-cards | variant: default | theme: ink -->
## Who

x

<!-- block: stats-bar | variant: 3-up | theme: light -->
## Stats

- **1** x

<!-- block: cta-banner | variant: image-bg | image: a.jpg | query: unquoted words -->
## Talk

y
`

describe('scanPageFile', () => {
  it('collects issues, themes in use and the hero pair', () => {
    const s = scanPageFile('contact.md', PAGE)
    expect(s.heroPair).toBe('hero|image-left')
    expect(s.themes).toEqual(['industry-cards|ink', 'stats-bar|light'])
    const kinds = s.issues.map((i) => `${i.kind}:${i.blockId}`)
    expect(kinds).toContain('stray:process-steps')
    expect(kinds).toContain('unparseable:cta-banner')
    expect(kinds).toContain('invalid-variant:industry-cards')
    expect(kinds).toContain('invalid-theme:stats-bar')
  })
  it('defaults the opener to page-header', () => {
    expect(scanPageFile('a.md', '---\ntitle: A\n---\nBody\n').heroPair).toBe('page-header|')
  })
})

describe('summarizeScans', () => {
  it('counts per kind/value and per page', () => {
    const s = summarizeScans([scanPageFile('contact.md', PAGE), scanPageFile('a.md', '---\ntitle: A\n---\nBody\n')])
    expect(s.pages).toBe(2)
    expect(s.issues['invalid-variant']).toEqual({ 'industry-cards|default': 1 })
    expect(s.themes['industry-cards|ink']).toBe(1)
    expect(s.heroPairs).toEqual({ 'hero|image-left': 1, 'page-header|': 1 })
    expect(Object.keys(s.pagesWithIssues)).toEqual(['contact.md'])
  })
})
