import { describe, it, expect } from 'vitest'
import { qaChip } from './chip'
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
