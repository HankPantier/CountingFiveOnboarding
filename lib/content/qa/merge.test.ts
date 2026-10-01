import { describe, it, expect } from 'vitest'
import { mergeFindings, type PageFields } from './merge'
import type { Finding } from '@/types/qa-review'

const body = '<!-- block: content-split | variant: image-right -->\n## A\n\nWe help clients grow. We help clients grow fast.\n\n<!-- block: content-split | variant: image-right -->\n## B\n\nMore.\n'
const fields: PageFields = { body, metaTitle: 'Old title', metaDescription: 'Old desc' }
const mk = (p: Partial<Finding>): Finding => ({
  id: Math.random().toString(), agent: 'copy', severity: 'low', kind: 'k', quote: '', message: 'm', safety: 'auto', status: 'open', ...p,
})

describe('mergeFindings', () => {
  it('shadow mode applies nothing', () => {
    const r = mergeFindings(fields, [mk({ patch: { target: 'meta_title', find: 'Old title', replace: 'New' } })], { apply: false, protectedTexts: [] })
    expect(r.fields).toEqual(fields)
    expect(r.findings[0].status).toBe('open')
  })
  it('applies a unique body patch and a meta patch', () => {
    const r = mergeFindings(fields, [
      mk({ patch: { target: 'body', find: 'grow fast', replace: 'grow faster' } }),
      mk({ patch: { target: 'meta_title', find: 'Old title', replace: 'New title' } }),
    ], { apply: true, protectedTexts: [] })
    expect(r.fields.body).toContain('grow faster')
    expect(r.fields.metaTitle).toBe('New title')
    expect(r.findings.every(f => f.status === 'applied')).toBe(true)
  })
  it('turns an ambiguous find into a flag', () => {
    const r = mergeFindings(fields, [mk({ patch: { target: 'body', find: 'We help clients grow', replace: 'X' } })], { apply: true, protectedTexts: [] })
    expect(r.fields.body).toBe(body)
    expect(r.findings[0]).toMatchObject({ safety: 'flag', status: 'open' })
  })
  it('never patches protected text', () => {
    const r = mergeFindings(fields, [mk({ patch: { target: 'body', find: 'More.', replace: 'Less.' } })], { apply: true, protectedTexts: ['More.'] })
    expect(r.fields.body).toBe(body)
    expect(r.findings[0].safety).toBe('flag')
  })
  it('reverts body patches that break an annotation', () => {
    const r = mergeFindings(fields, [mk({ patch: { target: 'body', find: 'block: content-split | variant: image-right -->\n## B', replace: 'block: not-a-block -->\n## B' } })], { apply: true, protectedTexts: [] })
    expect(r.fields.body).toBe(body)
    expect(r.findings[0].message).toContain('annotation')
  })
  it('applies a variant fix', () => {
    const r = mergeFindings(fields, [mk({ agent: 'rules', variantFix: { sectionIndex: 1, variant: 'image-left' } })], { apply: true, protectedTexts: [] })
    expect(r.fields.body).toContain('variant: image-left')
    expect(r.findings[0].status).toBe('applied')
  })
  it('leaves flag findings open', () => {
    const r = mergeFindings(fields, [mk({ safety: 'flag', patch: { target: 'body', find: 'More.', replace: 'X' } })], { apply: true, protectedTexts: [] })
    expect(r.fields.body).toBe(body)
    expect(r.findings[0].status).toBe('open')
  })
})
