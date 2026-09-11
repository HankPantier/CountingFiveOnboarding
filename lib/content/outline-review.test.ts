import { describe, it, expect } from 'vitest'
import { isPendingReview, nextPendingOutlineId, type OutlineApprovalState } from './outline-review'

const o = (id: string, h1: string | null, admin_approved: boolean): OutlineApprovalState => ({
  id,
  h1,
  admin_approved,
})

describe('isPendingReview', () => {
  it('is true only for a generated, unapproved outline', () => {
    expect(isPendingReview(o('a', 'Heading', false))).toBe(true)
    expect(isPendingReview(o('a', null, false))).toBe(false) // still generating
    expect(isPendingReview(o('a', 'Heading', true))).toBe(false) // approved
    expect(isPendingReview(o('a', '', false))).toBe(false) // no h1 yet
  })
})

describe('nextPendingOutlineId', () => {
  it('returns the next pending outline after the current one', () => {
    const list = [o('a', 'H', true), o('b', 'H', false), o('c', 'H', false)]
    expect(nextPendingOutlineId(list, 'b')).toBe('c')
  })

  it('skips still-generating and already-approved outlines', () => {
    const list = [o('a', 'H', false), o('b', null, false), o('c', 'H', true), o('d', 'H', false)]
    expect(nextPendingOutlineId(list, 'a')).toBe('d')
  })

  it('wraps to an earlier pending outline when none follow', () => {
    const list = [o('a', 'H', false), o('b', 'H', false)]
    expect(nextPendingOutlineId(list, 'b')).toBe('a')
  })

  it('returns null when nothing else needs review', () => {
    const list = [o('a', 'H', true), o('b', 'H', false)]
    expect(nextPendingOutlineId(list, 'b')).toBeNull()
  })

  it('never returns the current outline even if it is still pending', () => {
    const list = [o('a', 'H', false)]
    expect(nextPendingOutlineId(list, 'a')).toBeNull()
  })

  it('handles an unknown current id by scanning the whole list', () => {
    const list = [o('a', 'H', false), o('b', 'H', false)]
    expect(nextPendingOutlineId(list, 'zzz')).toBe('a')
  })
})
