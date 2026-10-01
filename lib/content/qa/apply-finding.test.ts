import { describe, it, expect } from 'vitest'
import { applyOneFinding } from './apply-finding'
import type { QaReview } from '@/types/qa-review'

const fields = { body: 'We have served Austin since 1998.\n', metaTitle: 't', metaDescription: 'd' }
const review: QaReview = {
  mode: 'on', ran_at: 't', judge: null, passed: false, scores: { accuracy: 7, copy: 10, seo: 10, structure: 10 },
  findings: [{ id: 'f1', agent: 'accuracy', severity: 'high', kind: 'unsupported_claim', quote: 'since 1998', message: 'm',
    patch: { target: 'body', find: 'We have served Austin since 1998.', replace: 'We serve Austin.' }, safety: 'flag', status: 'open' }],
}

describe('applyOneFinding', () => {
  it('applies a flagged patch on request and rescores', () => {
    const r = applyOneFinding(fields, review, 'f1', 'apply')
    if (!r.ok) throw new Error(r.error)
    expect(r.fields.body).toBe('We serve Austin.\n')
    expect(r.review.findings[0].status).toBe('accepted')
    expect(r.review.scores.accuracy).toBe(10)
    expect(r.review.passed).toBe(true)
  })
  it('dismisses without touching content', () => {
    const r = applyOneFinding(fields, review, 'f1', 'dismiss')
    if (!r.ok) throw new Error(r.error)
    expect(r.fields).toEqual(fields)
    expect(r.review.findings[0].status).toBe('dismissed')
  })
  it('errors when the target text has changed', () => {
    const r = applyOneFinding({ ...fields, body: 'Edited by a human.\n' }, review, 'f1', 'apply')
    expect(r.ok).toBe(false)
  })
  it('errors on an unknown or already-handled finding', () => {
    expect(applyOneFinding(fields, review, 'nope', 'apply').ok).toBe(false)
  })
})
