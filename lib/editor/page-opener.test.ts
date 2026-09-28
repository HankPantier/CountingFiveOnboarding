import { describe, expect, it } from 'vitest'
import { splitFile, serializeFile } from './frontmatter'
import {
  PAGE_OPENER_CHOICES,
  applyPageOpener,
  currentPageOpener,
  pageOpenerChoices,
  pageOpenerHints,
  pageOpenerSelectState,
  previewHeading,
} from './page-opener'

function fm(lines: string[]) {
  const parsed = splitFile(['---', ...lines, '---', '', 'Body.', ''].join('\n'))
  if (!parsed.frontmatter) throw new Error('no frontmatter')
  return parsed
}

function reserialize(lines: string[], choiceId: string): string[] {
  const parsed = fm(lines)
  const out = serializeFile({ ...parsed, frontmatter: applyPageOpener(parsed.frontmatter!, choiceId) })
  return out.split('\n---\n')[0].split('\n').slice(1)
}

describe('currentPageOpener', () => {
  it.each([
    [['title: A'], 'page-header'],
    [['hero: page-header'], 'page-header'],
    [['hero: hero-split'], 'split-right'],
    [['hero: hero-split', 'hero_variant: image-left'], 'split-left'],
    [['hero: "hero-split"', "hero_variant: 'image-right'"], 'split-right'],
    [['hero: hero', 'hero_variant: statement'], 'statement'],
    [['hero: hero'], 'image'],
    [['hero: hero', 'hero_variant: video'], 'video'],
    [['hero: hero', 'hero_variant: slider'], 'slider'],
    [['hero_block: hero-split', 'hero_variant: image-left'], 'split-left'],
  ])('%j → %s', (lines, id) => {
    expect(currentPageOpener(fm(lines).frontmatter!)).toEqual({ kind: 'choice', id })
  })

  it.each([
    [['hero: hero', 'hero_variant: image-right'], 'Custom: hero / image-right'],
    [['hero: hero-split', 'hero_variant: statement'], 'Custom: hero-split / statement'],
    [['hero: banner'], 'Custom: banner'],
    [['hero_variant: video'], 'Custom: (no hero) / video'],
    [['hero: page-header', 'hero_variant: image'], 'Custom: page-header / image'],
  ])('keeps an unknown pair visible: %j', (lines, label) => {
    expect(currentPageOpener(fm(lines).frontmatter!)).toEqual({ kind: 'custom', label })
  })
})

describe('applyPageOpener', () => {
  it('maps each choice to its (hero, hero_variant) pair', () => {
    const pairs = PAGE_OPENER_CHOICES.map((c) => {
      const next = applyPageOpener(fm(['title: A', 'hero: hero', 'hero_variant: statement']).frontmatter!, c.id)
      return [c.id, next.fields.hero, next.fields.hero_variant]
    })
    expect(pairs).toEqual([
      ['page-header', 'page-header', undefined],
      ['split-right', 'hero-split', 'image-right'],
      ['split-left', 'hero-split', 'image-left'],
      ['statement', 'hero', 'statement'],
      ['image', 'hero', 'image'],
      ['video', 'hero', 'video'],
      ['slider', 'hero', 'slider'],
    ])
  })

  it('rewrites the pair in place and leaves every other line alone', () => {
    expect(reserialize(['title: A', 'hero: hero', 'hero_variant: image-right', 'meta_title: B'], 'split-left')).toEqual([
      'title: A',
      'hero: hero-split',
      'hero_variant: image-left',
      'meta_title: B',
    ])
  })

  it('page header removes hero_variant', () => {
    expect(reserialize(['title: A', 'hero: hero-split', 'hero_variant: image-right'], 'page-header')).toEqual([
      'title: A',
      'hero: page-header',
    ])
  })

  it('adds hero_variant right after the hero key when missing', () => {
    expect(reserialize(['hero: hero-split', 'title: A'], 'split-left')).toEqual([
      'hero: hero-split',
      'hero_variant: image-left',
      'title: A',
    ])
    expect(reserialize(['title: A'], 'statement')).toEqual(['title: A', 'hero: hero', 'hero_variant: statement'])
  })

  it('writes to a legacy hero_block key instead of adding hero', () => {
    expect(reserialize(['hero_block: page-header', 'title: A'], 'statement')).toEqual([
      'hero_block: hero',
      'hero_variant: statement',
      'title: A',
    ])
  })

  it('ignores an unknown choice', () => {
    const f = fm(['hero: hero']).frontmatter!
    expect(applyPageOpener(f, 'nope')).toBe(f)
  })
})

describe('pageOpenerHints', () => {
  it('flags video without hero_video and slider without hero_images', () => {
    expect(pageOpenerHints(fm(['hero: hero', 'hero_variant: video']).frontmatter!)).toHaveLength(1)
    expect(pageOpenerHints(fm(['hero: hero', 'hero_variant: video', 'hero_video: intro.mp4']).frontmatter!)).toEqual([])
    expect(pageOpenerHints(fm(['hero: hero', 'hero_variant: slider']).frontmatter!)).toHaveLength(1)
    expect(pageOpenerHints(fm(['hero: hero', 'hero_variant: slider', 'hero_images: []']).frontmatter!)).toHaveLength(1)
    expect(pageOpenerHints(fm(['hero: hero', 'hero_variant: slider', 'hero_images: [a.jpg, b.jpg]']).frontmatter!)).toEqual([])
    expect(
      pageOpenerHints(fm(['hero: hero', 'hero_variant: slider', 'hero_images:', '  - a.jpg', '  - b.jpg']).frontmatter!),
    ).toEqual([])
    expect(pageOpenerHints(fm(['hero: hero', 'hero_variant: image']).frontmatter!)).toEqual([])
  })
})

describe('pageOpenerChoices', () => {
  it('offers every baseline choice on any template', () => {
    expect(pageOpenerChoices(null).map((c) => c.id)).toEqual(PAGE_OPENER_CHOICES.map((c) => c.id))
    expect(pageOpenerChoices('2026.09.8')).toHaveLength(PAGE_OPENER_CHOICES.length)
  })
})

describe('pageOpenerSelectState', () => {
  it('selects the matching choice when it is offered', () => {
    const st = pageOpenerSelectState(fm(['hero: hero', 'hero_variant: statement']).frontmatter!, null)
    expect(st.value).toBe('statement')
    expect(st.customLabel).toBeUndefined()
  })

  it('shows an unknown pair as a leading custom row', () => {
    const st = pageOpenerSelectState(fm(['hero: hero', 'hero_variant: image-right']).frontmatter!, null)
    expect(st).toMatchObject({ value: '__custom', customLabel: 'Custom: hero / image-right' })
  })
})

describe('previewHeading', () => {
  it('strips the quotes and the "| Firm" suffix from the title', () => {
    expect(previewHeading(fm(['title: "Accounting Services for Individuals | Accord Advisors"']).frontmatter)).toBe('Accounting Services for Individuals')
  })
  it('uses hero_headline on hero openers, not on page-header', () => {
    expect(previewHeading(fm(['title: "A | Firm"', 'hero: hero-split', 'hero_headline: "Built for your practice"']).frontmatter)).toBe('Built for your practice')
    expect(previewHeading(fm(['title: "A | Firm"', 'hero: page-header', 'hero_headline: "Ignored"']).frontmatter)).toBe('A')
    expect(previewHeading(fm(['title: Plain title']).frontmatter)).toBe('Plain title')
  })
  it('handles no frontmatter', () => {
    expect(previewHeading(null)).toBe('')
  })
})
