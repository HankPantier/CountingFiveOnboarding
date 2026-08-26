import { describe, expect, it } from 'vitest'
import {
  shouldChainGeneration,
  selectResumableContentJobs,
  finalizeGenerationIfComplete,
  MAX_GENERATION_ATTEMPTS,
} from './content-generator'

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

describe('selectResumableContentJobs', () => {
  it('resumes a job with never-attempted pending pages and nothing running', () => {
    const jobs = selectResumableContentJobs([
      { content_job_id: 'a', generation_status: 'complete' },
      { content_job_id: 'a', generation_status: 'pending' },
    ])
    expect(jobs).toEqual(['a'])
  })

  it('resumes a job whose only remaining work is a retriable error (the stranded-page case)', () => {
    // The exact hang: a page died mid-'running', got swept to 'error' under the
    // attempt cap. Every other page is complete → old pending-only filter missed
    // it and the job hung at phase 5 forever.
    const jobs = selectResumableContentJobs([
      { content_job_id: 'a', generation_status: 'complete' },
      { content_job_id: 'a', generation_status: 'error', generation_attempts: 1 },
    ])
    expect(jobs).toEqual(['a'])
  })

  it('does NOT resume while a page is still running (a live worker owns it)', () => {
    const jobs = selectResumableContentJobs([
      { content_job_id: 'a', generation_status: 'running', generation_attempts: 1 },
      { content_job_id: 'a', generation_status: 'error', generation_attempts: 1 },
    ])
    expect(jobs).toEqual([])
  })

  it('does NOT resume a capped-out error — it is terminal, so the job finalizes instead', () => {
    const jobs = selectResumableContentJobs([
      { content_job_id: 'a', generation_status: 'complete' },
      { content_job_id: 'a', generation_status: 'error', generation_attempts: MAX_GENERATION_ATTEMPTS },
    ])
    expect(jobs).toEqual([])
  })

  it('does NOT resume a fully-complete job', () => {
    const jobs = selectResumableContentJobs([
      { content_job_id: 'a', generation_status: 'complete' },
      { content_job_id: 'a', generation_status: 'complete' },
    ])
    expect(jobs).toEqual([])
  })

  it('scopes running/work independently per job', () => {
    const jobs = selectResumableContentJobs([
      // job a: a running page blocks resume even though b is ready
      { content_job_id: 'a', generation_status: 'running', generation_attempts: 1 },
      { content_job_id: 'b', generation_status: 'error', generation_attempts: 1 },
      { content_job_id: 'b', generation_status: 'complete' },
    ])
    expect(jobs).toEqual(['b'])
  })
})

// Minimal chainable Supabase stub: from().select().eq() resolves to {data},
// from().update().eq() records the write, from().select().eq().single() for the
// phase read. Enough to exercise finalizeGenerationIfComplete's branches.
function makeSupabaseStub(opts: {
  pages: Array<{ generation_status: string; generation_attempts?: number }>
  phase: number
}) {
  const updates: Array<Record<string, unknown>> = []
  const supabase = {
    from(table: string) {
      if (table === 'generated_pages') {
        return { select: () => ({ eq: () => Promise.resolve({ data: opts.pages }) }) }
      }
      // content_jobs
      return {
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { phase: opts.phase } }) }) }),
        update: (vals: Record<string, unknown>) => {
          updates.push(vals)
          return { eq: () => Promise.resolve({ data: null, error: null }) }
        },
      }
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, updates }
}

describe('finalizeGenerationIfComplete', () => {
  it('advances a phase-5 job to 6 when every page is complete', async () => {
    const { supabase, updates } = makeSupabaseStub({
      pages: [{ generation_status: 'complete' }, { generation_status: 'complete' }],
      phase: 5,
    })
    const advanced = await finalizeGenerationIfComplete(supabase, 'job-1')
    expect(advanced).toBe(true)
    expect(updates[0]).toMatchObject({ phase: 6 })
  })

  it('advances when the only non-complete page is a capped-out error', async () => {
    const { supabase, updates } = makeSupabaseStub({
      pages: [
        { generation_status: 'complete' },
        { generation_status: 'error', generation_attempts: MAX_GENERATION_ATTEMPTS },
      ],
      phase: 5,
    })
    expect(await finalizeGenerationIfComplete(supabase, 'job-1')).toBe(true)
    expect(updates[0]).toMatchObject({ phase: 6 })
  })

  it('does NOT advance while an error is still retriable (work should resume, not finalize)', async () => {
    const { supabase, updates } = makeSupabaseStub({
      pages: [
        { generation_status: 'complete' },
        { generation_status: 'error', generation_attempts: 1 },
      ],
      phase: 5,
    })
    expect(await finalizeGenerationIfComplete(supabase, 'job-1')).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('is a no-op when the job is already at phase 6', async () => {
    const { supabase, updates } = makeSupabaseStub({
      pages: [{ generation_status: 'complete' }],
      phase: 6,
    })
    expect(await finalizeGenerationIfComplete(supabase, 'job-1')).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('does not advance a job with no pages', async () => {
    const { supabase, updates } = makeSupabaseStub({ pages: [], phase: 5 })
    expect(await finalizeGenerationIfComplete(supabase, 'job-1')).toBe(false)
    expect(updates).toHaveLength(0)
  })
})
