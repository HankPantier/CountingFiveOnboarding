import { describe, expect, it } from 'vitest'
import { applyFindReplace, applyBatchEdits, validatePageAnnotations } from './apply-edit'

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

  it('does not compound a self-referential replacement on re-run (all=true)', () => {
    const doc = 'a service business and a service business'
    const first = applyFindReplace(doc, 'service business', 'professional service business', true)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.next).toBe('a professional service business and a professional service business')
    // Re-running the same wrapping edit must be a no-op, not add another "professional".
    const second = applyFindReplace(first.next, 'service business', 'professional service business', true)
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.next).toBe(first.next)
  })
})

describe('applyBatchEdits', () => {
  it('applies every rewrite in one pass and folds them into next', () => {
    const res = applyBatchEdits(PAGE, [
      { find: 'Some prose about advisory work.', replace: 'Rewritten advisory copy.' },
      { find: '## Tax', replace: '## Tax Prep' },
    ])
    expect(res.failed).toEqual([])
    expect(res.applied).toEqual([
      { find: 'Some prose about advisory work.', replacements: 1 },
      { find: '## Tax', replacements: 1 },
    ])
    expect(res.next).toContain('Rewritten advisory copy.')
    expect(res.next).toContain('## Tax Prep')
  })

  it('collects a missing find into failed without aborting the rest', () => {
    const res = applyBatchEdits(PAGE, [
      { find: 'nonexistent snippet', replace: 'x' },
      { find: 'Some prose about advisory work.', replace: 'Rewritten.' },
    ])
    expect(res.applied).toEqual([{ find: 'Some prose about advisory work.', replacements: 1 }])
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0].find).toBe('nonexistent snippet')
    expect(res.next).toContain('Rewritten.')
  })

  it('collects an ambiguous find into failed unless all=true', () => {
    const ambiguous = applyBatchEdits(PAGE, [{ find: '(555) 111-2222', replace: '(555) 999-0000' }])
    expect(ambiguous.applied).toEqual([])
    expect(ambiguous.failed).toHaveLength(1)

    const all = applyBatchEdits(PAGE, [{ find: '(555) 111-2222', replace: '(555) 999-0000', all: true }])
    expect(all.failed).toEqual([])
    expect(all.applied).toEqual([{ find: '(555) 111-2222', replacements: 2 }])
    expect(all.next).not.toContain('(555) 111-2222')
  })

  it('leaves content unchanged and applied empty when every find misses', () => {
    const res = applyBatchEdits(PAGE, [{ find: 'nope', replace: 'x' }])
    expect(res.next).toBe(PAGE)
    expect(res.applied).toEqual([])
    expect(res.failed).toHaveLength(1)
  })

  it('returns the original content for an empty edit list', () => {
    const res = applyBatchEdits(PAGE, [])
    expect(res).toEqual({ next: PAGE, applied: [], failed: [] })
  })

  it('does not compound a self-referential batch rewrite across re-runs', () => {
    const doc = 'Farm and service business owners in Brookings.'
    const first = applyBatchEdits(doc, [
      { find: 'service business', replace: 'professional service business', all: true },
    ])
    expect(first.next).toBe('Farm and professional service business owners in Brookings.')
    const second = applyBatchEdits(first.next, [
      { find: 'service business', replace: 'professional service business', all: true },
    ])
    expect(second.next).toBe(first.next)
    expect((second.next.match(/professional/g) || []).length).toBe(1)
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
