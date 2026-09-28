import { describe, expect, it } from 'vitest'
import { applyFindReplace, applyBatchEdits, checkEditAnnotations } from './apply-edit'

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
    // Now reported as an explicit no-op (not a successful change to commit).
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.noop).toBe(true)
  })

  it('reports an already-applied edit as a no-op, not success', () => {
    const res = applyFindReplace(PAGE, 'Advisory', 'Advisory')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.noop).toBe(true)
      expect(res.reason).toMatch(/already applied/i)
    }
  })

  it('a genuine miss is not flagged noop', () => {
    const res = applyFindReplace(PAGE, 'nope', 'x')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.noop).toBeUndefined()
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
    expect(res).toEqual({ next: PAGE, applied: [], failed: [], unchanged: [] })
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
    // The re-run is reported as unchanged, not as an applied edit.
    expect(second.applied).toEqual([])
    expect(second.failed).toEqual([])
    expect(second.unchanged).toHaveLength(1)
  })
})

function edit(page: string, find: string, replace: string): string {
  const res = applyFindReplace(page, find, replace)
  if (!res.ok) throw new Error(res.reason)
  return res.next
}

describe('checkEditAnnotations', () => {
  it('accepts an unchanged valid page', () => {
    expect(checkEditAnnotations(PAGE, PAGE)).toEqual({ errors: [], warnings: [] })
  })

  it('accepts a flipped variant', () => {
    expect(checkEditAnnotations(PAGE, edit(PAGE, 'variant: image-right', 'variant: image-left')).errors).toEqual([])
  })

  it('flags an invalid variant the edit introduces', () => {
    const errors = checkEditAnnotations(PAGE, edit(PAGE, 'variant: image-right', 'variant: sideways')).errors
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('sideways')
  })

  it('flags an unknown block id the edit introduces', () => {
    const errors = checkEditAnnotations(PAGE, edit(PAGE, 'block: content-split | variant: image-right', 'block: made-up-block')).errors
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('made-up-block')
  })

  describe('legacy values already on the page', () => {
    const LEGACY = `---
title: Contact
hero: hero
hero_variant: statement
---
<!-- block: intro-text | variant: centered -->
## Get in touch

Call us any time.

<!-- block: industry-cards | variant: default -->
## Who we serve

Everyone.

<!-- block: content-prose | variant: standard -->
## Notes

Some notes.

<!-- block: contact-info -->
## How to Reach Us

<!-- block: map -->
## Where to Find Us

<!-- block: form | variant: custom -->
## Send a message

- Name (text, required)
`

    it('do not block an unrelated copy edit (bblcpa contact page case)', () => {
      const next = edit(LEGACY, 'intro-text | variant: centered', 'intro-text | variant: left-aligned')
      expect(checkEditAnnotations(LEGACY, next)).toEqual({ errors: [], warnings: [] })
      expect(checkEditAnnotations(LEGACY, edit(LEGACY, '## Notes', '## Our notes')).errors).toEqual([])
    })

    it('still reject a NEW copy of the same bad value', () => {
      const next = edit(LEGACY, '<!-- block: intro-text | variant: centered -->', '<!-- block: intro-text | variant: default -->')
      expect(checkEditAnnotations(LEGACY, next).errors).toHaveLength(1)
    })

    it('reject an unsupported theme and an inline page opener', () => {
      const inked = edit(LEGACY, '<!-- block: intro-text | variant: centered -->', '<!-- block: intro-text | variant: centered | theme: ink -->')
      expect(checkEditAnnotations(LEGACY, inked).errors[0]).toContain('does not support a theme')
      const opener = edit(LEGACY, '<!-- block: intro-text | variant: centered -->', '<!-- block: hero-split | variant: image-right -->')
      expect(checkEditAnnotations(LEGACY, opener).errors[0]).toContain('page opener')
    })

    it('accept an ink band where the block supports it', () => {
      const next = edit(LEGACY, '<!-- block: industry-cards | variant: default -->', '<!-- block: industry-cards | variant: 3-col | theme: ink -->')
      expect(checkEditAnnotations(LEGACY, next).errors).toEqual([])
    })
  })

  describe('page opener warnings', () => {
    const withHero = (hero: string, variant: string) => PAGE.replace('title: Services', `title: Services\nhero: ${hero}\nhero_variant: ${variant}`)

    it('warn (never error) when the edit sets an unrenderable pair', () => {
      const res = checkEditAnnotations(withHero('hero', 'statement'), withHero('hero', 'image-left'))
      expect(res.errors).toEqual([])
      expect(res.warnings[0]).toContain('hero-split')
      expect(checkEditAnnotations(withHero('hero', 'image'), withHero('banner', 'image')).warnings[0]).toContain('not a page opener')
      const noHero = PAGE.replace('title: Services', 'title: Services\nhero_variant: image')
      expect(checkEditAnnotations(PAGE, noHero).warnings[0]).toContain('without hero')
    })

    it('stay quiet when the pair is valid or unchanged', () => {
      expect(checkEditAnnotations(withHero('hero', 'image'), withHero('hero-split', 'image-left')).warnings).toEqual([])
      expect(checkEditAnnotations(withHero('hero', 'wobbly'), edit(withHero('hero', 'wobbly'), 'Some prose', 'Other prose')).warnings).toEqual([])
      expect(checkEditAnnotations(withHero('hero', 'image'), withHero('"hero"', "'video'")).warnings).toEqual([])
    })
  })
})
