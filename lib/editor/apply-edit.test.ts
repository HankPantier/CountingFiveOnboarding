import { describe, expect, it } from 'vitest'
import { applyFindReplace, validatePageAnnotations } from './apply-edit'

const PAGE = `---
title: Services
---
<!-- block: content-split | variant: image-right | image: a.jpg | alt: "x" | query: "y" -->
## Advisory

Some prose about advisory work.

<!-- block: content-split | variant: image-left | image: b.jpg | alt: "x" | query: "y" -->
## Tax

Call us at (555) 111-2222 or (555) 111-2222 today.
`

describe('applyFindReplace', () => {
  it('replaces a unique snippet', () => {
    const res = applyFindReplace(PAGE, 'Some prose about advisory work.', 'Rewritten advisory copy.')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.count).toBe(1)
      expect(res.next).toContain('Rewritten advisory copy.')
    }
  })

  it('flips a content-split variant (layout edit)', () => {
    const res = applyFindReplace(PAGE, 'variant: image-right', 'variant: image-left')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.next).toContain('block: content-split | variant: image-left | image: a.jpg')
  })

  it('rejects a snippet that is not present', () => {
    const res = applyFindReplace(PAGE, 'nonexistent snippet', 'x')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.count).toBe(0)
  })

  it('rejects an ambiguous snippet unless all=true', () => {
    const ambiguous = applyFindReplace(PAGE, '(555) 111-2222', '(555) 999-0000')
    expect(ambiguous.ok).toBe(false)
    if (!ambiguous.ok) expect(ambiguous.count).toBe(2)

    const all = applyFindReplace(PAGE, '(555) 111-2222', '(555) 999-0000', true)
    expect(all.ok).toBe(true)
    if (all.ok) {
      expect(all.count).toBe(2)
      expect(all.next).not.toContain('(555) 111-2222')
    }
  })

  it('rejects an empty find', () => {
    expect(applyFindReplace(PAGE, '', 'x').ok).toBe(false)
  })
})

describe('validatePageAnnotations', () => {
  it('accepts a valid page', () => {
    expect(validatePageAnnotations(PAGE)).toEqual([])
  })

  it('accepts a flipped variant', () => {
    const flipped = applyFindReplace(PAGE, 'variant: image-right', 'variant: image-left')
    if (flipped.ok) expect(validatePageAnnotations(flipped.next)).toEqual([])
  })

  it('flags an invalid variant', () => {
    const broken = applyFindReplace(PAGE, 'variant: image-right', 'variant: sideways')
    if (broken.ok) {
      const errors = validatePageAnnotations(broken.next)
      expect(errors.length).toBe(1)
      expect(errors[0]).toContain('sideways')
    }
  })

  it('flags an unknown block id', () => {
    const broken = applyFindReplace(PAGE, 'block: content-split | variant: image-right', 'block: made-up-block')
    if (broken.ok) {
      const errors = validatePageAnnotations(broken.next)
      expect(errors.length).toBe(1)
      expect(errors[0]).toContain('made-up-block')
    }
  })
})
