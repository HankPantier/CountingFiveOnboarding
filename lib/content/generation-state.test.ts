import { describe, it, expect } from 'vitest'
import { summarizeGenerationState, selectUnfinishedPages, scopeToApproved } from './generation-state'
import { shouldChainGeneration, callTimeoutFor, hasTimeForRetry, MAX_GENERATION_ATTEMPTS, ORPHAN_RECLAIM_MS, GENERATE_ROUTE_MAX_DURATION_MS } from './content-generator'

const MAX = MAX_GENERATION_ATTEMPTS

describe('summarizeGenerationState', () => {
  it('ignores pending rows for unapproved outlines — no infinite chain', () => {
    // Regression: rows are seeded for the whole sitemap at confirm; only 2 of 3
    // outlines were approved. The unapproved page's `pending` row used to keep
    // pendingCount > 0 forever, so shouldChainGeneration re-chained with
    // completed=0 on every invocation and the job never finalized.
    const pages = [
      { page_url: '/a', generation_status: 'complete' },
      { page_url: '/b', generation_status: 'complete' },
      { page_url: '/c', generation_status: 'pending' },
    ]
    const s = summarizeGenerationState(pages, new Set(['/a', '/b']), MAX)
    expect(s.pendingCount).toBe(0)
    expect(s.allDone).toBe(true)
    expect(
      shouldChainGeneration({ allDone: s.allDone, retriableErrorCount: s.retriableErrorCount, completedThisRun: 0, pendingCount: s.pendingCount })
    ).toBe(false)
  })

  it('still counts pending approved pages as outstanding work', () => {
    const s = summarizeGenerationState(
      [
        { page_url: '/a', generation_status: 'complete' },
        { page_url: '/b', generation_status: 'pending' },
      ],
      new Set(['/a', '/b']),
      MAX
    )
    expect(s.pendingCount).toBe(1)
    expect(s.allDone).toBe(false)
  })

  it('treats capped-out errors as terminal and under-cap errors as retriable', () => {
    const s = summarizeGenerationState(
      [
        { page_url: '/a', generation_status: 'error', generation_attempts: MAX },
        { page_url: '/b', generation_status: 'error', generation_attempts: 1 },
      ],
      null,
      MAX
    )
    expect(s.errorCount).toBe(2)
    expect(s.retriableErrorCount).toBe(1)
    expect(s.allDone).toBe(false)
  })

  it('is never "done" with nothing in scope', () => {
    expect(summarizeGenerationState([{ page_url: '/a', generation_status: 'pending' }], new Set(), MAX).allDone).toBe(false)
  })
})

describe('scopeToApproved', () => {
  it('passes everything through when the approved set is unknown', () => {
    const rows = [{ page_url: '/x' }]
    expect(scopeToApproved(rows, null)).toEqual(rows)
  })
})

describe('selectUnfinishedPages', () => {
  it('flags running pages and pending pages with an approved outline', () => {
    const pages = [
      { page_url: '/a', generation_status: 'running' },
      { page_url: '/b', generation_status: 'pending' },
      { page_url: '/c', generation_status: 'pending' }, // outline never approved
      { page_url: '/d', generation_status: 'complete' },
      { page_url: '/e', generation_status: 'error' },
    ]
    expect(selectUnfinishedPages(pages, new Set(['/a', '/b', '/d', '/e'])).map(p => p.page_url)).toEqual(['/a', '/b'])
  })
})

describe('page deadline helpers', () => {
  it('clips each call timeout to the page deadline', () => {
    expect(callTimeoutFor(10_000 + 50_000, 200_000, 10_000)).toBe(50_000)
    expect(callTimeoutFor(10_000 + 500_000, 200_000, 10_000)).toBe(200_000)
    expect(callTimeoutFor(undefined, 200_000, 10_000)).toBe(200_000)
    // Past the deadline: 1ms floor keeps AbortSignal.timeout() valid.
    expect(callTimeoutFor(5_000, 200_000, 10_000)).toBe(1)
  })

  it('skips optional retries near the deadline', () => {
    expect(hasTimeForRetry(100_000 + 30_000, 100_000)).toBe(false)
    expect(hasTimeForRetry(100_000 + 300_000, 100_000)).toBe(true)
    expect(hasTimeForRetry(undefined, 100_000)).toBe(true)
  })

  it('reclaims orphans only after any worker is provably dead', () => {
    expect(ORPHAN_RECLAIM_MS).toBeGreaterThan(GENERATE_ROUTE_MAX_DURATION_MS)
  })
})
