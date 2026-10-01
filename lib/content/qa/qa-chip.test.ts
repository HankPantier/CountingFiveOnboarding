import { describe, it, expect } from 'vitest'
import { qaChip, pickPageChips, needsReviewBannerCopy } from './chip'
import type { QaSummary } from '@/types/qa-review'

const s = (p: Partial<QaSummary>): QaSummary => ({ fixed: 0, open: 0, highOpen: 0, passed: true, judgeOverall: 8, mode: 'on', ...p })

describe('qaChip', () => {
  it('shows progress and failure states', () => {
    expect(qaChip(null, 'running')?.label).toBe('QA…')
    expect(qaChip(null, 'error')?.label).toBe('QA unavailable')
    expect(qaChip(null, null)).toBeNull()
  })
  it('summarises a finished review', () => {
    expect(qaChip(s({ fixed: 9 }), 'done')?.label).toBe('QA ✓ fixed 9')
    expect(qaChip(s({ fixed: 9, open: 2, highOpen: 1, passed: false }), 'done')?.label).toBe('QA: needs you 2')
    expect(qaChip(s({ fixed: 3, open: 2, passed: false }), 'done')?.label).toBe('QA: fixed 3 · needs you 2')
    expect(qaChip(s({ mode: 'shadow', open: 4 }), 'done')?.label).toBe('QA (shadow) ⚑4')
  })
})

describe('pickPageChips', () => {
  const critic = { overall: 5, hasFlags: true, needsReview: true }
  it('on mode: the QA chip replaces the critic chip', () => {
    const r = pickPageChips(s({ fixed: 2 }), 'done', critic)
    expect(r.primary?.label).toBe('QA ✓ fixed 2')
    expect(r.secondary).toBeNull()
  })
  it('on mode: falls back to the critic chip when QA has nothing to show', () => {
    expect(pickPageChips(null, null, critic, 'on').primary?.label).toBe('Review 5/10 ⚑')
  })
  it('on mode (told by the server): queued/running QA replaces the critic chip', () => {
    const r = pickPageChips(null, 'running', critic, 'on')
    expect(r.primary?.label).toBe('QA…')
    expect(r.secondary).toBeNull()
  })
  it('shadow review: critic chip stays primary (incl. red needs-review), QA chip is secondary', () => {
    const r = pickPageChips(s({ mode: 'shadow', open: 3 }), 'done', critic)
    expect(r.primary?.label).toBe('Review 5/10 ⚑')
    expect(r.primary?.cls).toContain('text-error')
    expect(r.secondary?.label).toBe('QA (shadow) ⚑3')
  })
  it('queued/running/error with no summary is treated as shadow unless told otherwise', () => {
    for (const st of ['queued', 'running', 'error']) {
      const r = pickPageChips(null, st, critic)
      expect(r.primary?.label).toBe('Review 5/10 ⚑')
      expect(r.secondary).not.toBeNull()
    }
    expect(pickPageChips(null, 'error', critic, 'shadow').primary?.label).toBe('Review 5/10 ⚑')
  })
  it('shadow with no critic: only the secondary QA chip', () => {
    const r = pickPageChips(s({ mode: 'shadow', open: 1 }), 'done', null)
    expect(r.primary).toBeNull()
    expect(r.secondary?.label).toBe('QA (shadow) ⚑1')
  })
})

describe('needsReviewBannerCopy', () => {
  it('uses the QA copy only when an on-mode QA page is in the list', () => {
    expect(needsReviewBannerCopy(2, true)).toMatch(/^Automated QA flagged 2 page/)
    expect(needsReviewBannerCopy(2, false)).toMatch(/^The quality critic auto-rewrote these once/)
    expect(needsReviewBannerCopy(1, false)).toMatch(/^The quality critic auto-rewrote this once and still flagged it/)
  })
})
