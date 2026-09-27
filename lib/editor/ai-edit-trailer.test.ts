import { describe, expect, it } from 'vitest'
import { applyBatchEdits, applyFindReplace } from './apply-edit'
import { applyBulkRemovals } from './bulk-remove'
import { applyRemovalsToTrailer, composeAiEditCommit, splitForModel } from './ai-edit-trailer'

const FM = '---\ntitle: "Services | Accord Advisors"\nmeta_description: "Fixed fees — no surprises."\n---\n'
const BODY = '\n<!-- block: intro-text -->\n## Services\n\nClean books — every month.\n'
const TRAILER =
  '\n---\n## SEO & AIO Metadata\n\n**Answer Block:**\nAccord Advisors — fixed fees.\n\n**Internal Links:**\n- tax → /services/tax — why\n\n---\n## Structured Data — paste into `<head>`\n\n```html\n<script type="application/ld+json">{"name":"Accord Advisors"}</script>\n```\n'
const PAGE = FM + BODY + TRAILER

describe('splitForModel', () => {
  it('hides the trailer from the model and loses nothing', () => {
    const v = splitForModel(PAGE)
    expect(v.visible).toBe(FM + BODY)
    expect(v.trailer).toBe(TRAILER)
    expect(v.visible).not.toContain('SEO & AIO Metadata')
    expect(v.visible).not.toContain('Structured Data')
  })
})

describe('a model edit cannot touch the trailer', () => {
  it('apply_edit on the trailer heading misses (not in the view), and the commit keeps it', () => {
    const { visible, trailer } = splitForModel(PAGE)
    expect(applyFindReplace(visible, '## SEO & AIO Metadata', '', false).ok).toBe(false)
    const edit = applyFindReplace(visible, 'Clean books', 'Accurate books', false)
    expect(edit.ok).toBe(true)
    if (!edit.ok) return
    const out = composeAiEditCommit(edit.next, trailer, 'content/pages/services.md')
    expect(out).toContain('Accurate books')
    expect(out.endsWith(TRAILER)).toBe(true)
  })

  it('apply_edits deleting "everything after the body" cannot reach the trailer', () => {
    const { visible, trailer } = splitForModel(PAGE)
    const res = applyBatchEdits(visible, [{ find: '---\n## SEO & AIO Metadata', replace: '' }])
    expect(res.next).toBe(visible)
    expect(composeAiEditCommit(res.next, trailer, 'content/pages/services.md')).toBe(
      FM + BODY.replace('Clean books — every month.', 'Clean books, every month.') + TRAILER
    )
  })
})

describe('composeAiEditCommit — post/page branching', () => {
  it('page: re-attaches the trailer verbatim; dashes scrubbed in the body only', () => {
    const { visible, trailer } = splitForModel(PAGE)
    const out = composeAiEditCommit(visible, trailer, 'content/pages/services.md')
    expect(out).toBe(FM + BODY.replace(' — ', ', ') + TRAILER)
  })

  it('page: restores a missing SEO marker so the template keeps trimming', () => {
    const orphan = TRAILER.replace('\n---\n## SEO & AIO Metadata\n', '\n---\n')
    const out = composeAiEditCommit(FM + BODY, orphan, 'content/pages/services.md')
    expect(out).toContain('\n---\n## SEO & AIO Metadata\n\n**Answer Block:**')
  })

  it('post: drops the trailer entirely (the post renderer shows everything)', () => {
    const { visible, trailer } = splitForModel(PAGE)
    const out = composeAiEditCommit(visible, trailer, 'content/posts/year-end.md')
    // Empty frontmatter fields are filled from the trailer so nothing is lost.
    expect(out).toContain('answer_block: "Accord Advisors — fixed fees."')
    expect(out).toContain('internal_links: [{"url":"/services/tax","anchor_text":"tax","reason":"why"}]')
    expect(out.endsWith(BODY.replace(' — ', ', '))).toBe(true)
    expect(out).not.toContain('SEO & AIO Metadata')
    expect(out).not.toContain('ld+json')
  })
})

describe('remove_text stripDashes scrubs body prose only', () => {
  it('leaves frontmatter and the trailer byte-identical', () => {
    const res = applyBulkRemovals(PAGE, [], { stripDashes: true })
    expect(res.next).toBe(FM + BODY.replace(' — ', ', ') + TRAILER)
    expect(res.dashesStripped).toBe(1)
  })
})

describe('applyRemovalsToTrailer', () => {
  it('lets a firm rename reach the hidden JSON-LD', () => {
    const next = applyRemovalsToTrailer(TRAILER, [{ find: 'Accord Advisors', replace: 'Accord CPAs' }], false)
    expect(next).toContain('{"name":"Accord CPAs"}')
    expect(next).toContain('## SEO & AIO Metadata')
  })

  it('discards removals that would change a heading, rule or label line', () => {
    expect(applyRemovalsToTrailer(TRAILER, [{ find: 'SEO & AIO Metadata' }], false)).toBe(TRAILER)
    expect(applyRemovalsToTrailer(TRAILER, [{ find: 'Internal Links' }], false)).toBe(TRAILER)
    expect(applyRemovalsToTrailer(TRAILER, [{ find: '—', replace: ',' }], false)).toBe(TRAILER)
  })
})
