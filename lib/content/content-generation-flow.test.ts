import { describe, expect, it } from 'vitest'
import { shouldChainGeneration } from './content-generator'

describe('shouldChainGeneration', () => {
  it('finalizes when every page is complete', () => {
    // Nothing left to do — advance to phase 6, no chain.
    expect(
      shouldChainGeneration({ allDone: true, retriableErrorCount: 0, completedThisRun: 5 })
    ).toBe(false)
  })

  it('chains when pending work remains and progress was made', () => {
    // Soft-deadline hit mid-job with pending pages left.
    expect(
      shouldChainGeneration({ allDone: false, retriableErrorCount: 0, completedThisRun: 3 })
    ).toBe(true)
  })

  it('chains to retry a lone transient error while under the attempt cap', () => {
    // 56 complete, 1 error still retriable → chain one more invocation to retry.
    expect(
      shouldChainGeneration({ allDone: false, retriableErrorCount: 1, completedThisRun: 56 })
    ).toBe(true)
  })

  it('chains to retry a retriable error even when this run made no new completions', () => {
    // A retry invocation that only re-ran the error page; the attempt cap (not a
    // progress gate) is what bounds this, so it may retry again.
    expect(
      shouldChainGeneration({ allDone: false, retriableErrorCount: 1, completedThisRun: 0 })
    ).toBe(true)
  })

  it('finalizes once all remaining errors are capped out (allDone)', () => {
    // Every page is complete or a capped-out error → stop, finalize into
    // ERRORS.md. This is what makes the retry loop terminate.
    expect(
      shouldChainGeneration({ allDone: true, retriableErrorCount: 0, completedThisRun: 0 })
    ).toBe(false)
  })
})
