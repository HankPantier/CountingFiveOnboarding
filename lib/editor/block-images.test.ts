import { describe, expect, it } from 'vitest'
import { extractImageBlocks, setBlockImage, setBlockAlt } from './block-images'

const BODY = [
  '<!-- block: content-split | variant: image-right | image: a.jpg | alt: "Accountant with a client" | query: "office meeting" -->',
  '## Our Approach',
  '',
  'Prose.',
  '',
  '<!-- block: checklist-section | variant: with-image -->',
  '## Who We Serve',
  '',
  '- Item',
].join('\n')

describe('extractImageBlocks with alt', () => {
  it('captures alt alongside image and query', () => {
    const refs = extractImageBlocks(BODY)
    expect(refs[0]).toMatchObject({
      blockId: 'content-split',
      image: 'a.jpg',
      alt: 'Accountant with a client',
      query: 'office meeting',
    })
    expect(refs[1]).toMatchObject({ blockId: 'checklist-section', image: null, alt: null })
  })
})

describe('setBlockAlt', () => {
  it('adds an alt to a comment that lacks one, in the image|alt|query order', () => {
    const refs = extractImageBlocks(BODY)
    const withImage = setBlockImage(BODY, refs[1], 'who.jpg')
    const ref = extractImageBlocks(withImage)[1]
    const out = setBlockAlt(withImage, ref, 'Small business owners at a planning session')
    expect(out).toContain(
      '<!-- block: checklist-section | variant: with-image | image: who.jpg | alt: "Small business owners at a planning session" -->'
    )
  })

  it('replaces and removes an existing alt', () => {
    const refs = extractImageBlocks(BODY)
    const replaced = setBlockAlt(BODY, refs[0], 'New description')
    expect(replaced).toContain('| alt: "New description" | query: "office meeting"')
    const removed = setBlockAlt(BODY, refs[0], null)
    expect(removed).toContain('| image: a.jpg | query: "office meeting"')
    expect(removed).not.toContain('alt:')
  })

  it('strips quotes that would break the comment grammar', () => {
    const refs = extractImageBlocks(BODY)
    const out = setBlockAlt(BODY, refs[0], 'A "quoted" description')
    expect(out).toContain('| alt: "A quoted description"')
  })
})

describe('setBlockImage alt interaction', () => {
  it('removing the image also drops its alt', () => {
    const refs = extractImageBlocks(BODY)
    const out = setBlockImage(BODY, refs[0], null)
    expect(out).toContain('<!-- block: content-split | variant: image-right | query: "office meeting" -->')
    expect(out).not.toContain('alt:')
  })

  it('swapping the image keeps the existing alt', () => {
    const refs = extractImageBlocks(BODY)
    const out = setBlockImage(BODY, refs[0], 'b.jpg')
    expect(out).toContain('| image: b.jpg | alt: "Accountant with a client" |')
  })
})

describe('leniently-parsed comments are read-only', () => {
  const PROBE =
    '<!-- block: cta-banner | image: a.jpg | variant: image-bg | alt: Our team | at work | foo: bar -->\n## Talk\n\nBody\n'
  it('lists the block as non-strict and never rewrites it', () => {
    const [ref] = extractImageBlocks(PROBE)
    expect(ref).toMatchObject({ blockId: 'cta-banner', image: 'a.jpg', strict: false })
    expect(setBlockImage(PROBE, ref, 'b.jpg')).toBe(PROBE)
    expect(setBlockImage(PROBE, ref, null)).toBe(PROBE)
    expect(setBlockAlt(PROBE, ref, 'New alt')).toBe(PROBE)
  })
  it('strict comments stay editable', () => {
    const ok = '<!-- block: cta-banner | variant: image-bg | image: a.jpg -->\n## Talk\n'
    const [ref] = extractImageBlocks(ok)
    expect(ref.strict).toBe(true)
    expect(setBlockImage(ok, ref, 'b.jpg')).toContain('image: b.jpg')
  })
})
