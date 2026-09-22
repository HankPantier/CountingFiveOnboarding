import { describe, expect, it } from 'vitest'
import { resumeEndpointFor, resumePlan } from './resume-targets'

describe('resumeEndpointFor', () => {
  // The regression this exists for: the sweep always called /run, but /run
  // short-circuits on a terminal job (pending + drafting === 0). A job whose
  // items had ALL failed was terminal, so the cron logged a success and did
  // nothing — leaving the human "Retry failed (N)" button as the only way out.
  it('sends an all-error job to retry, not run', () => {
    expect(resumeEndpointFor({ pending: 0, drafting: 0, error: 12 })).toBe('retry')
  })

  it('sends a job with only fresh work to run', () => {
    expect(resumeEndpointFor({ pending: 4, drafting: 0, error: 0 })).toBe('run')
  })

  it('prefers retry when a job has both failed and fresh items', () => {
    // /retry resets the errors to pending and then runs everything pending,
    // so it strictly covers /run's job here.
    expect(resumeEndpointFor({ pending: 3, drafting: 0, error: 2 })).toBe('retry')
  })

  it('stays out of the way while work is genuinely in flight', () => {
    expect(resumeEndpointFor({ pending: 5, drafting: 1, error: 3 })).toBeNull()
  })

  it('does nothing for a finished job', () => {
    expect(resumeEndpointFor({ pending: 0, drafting: 0, error: 0 })).toBeNull()
  })
})

describe('resumePlan', () => {
  it('groups rows per job and picks each endpoint', () => {
    const plan = resumePlan([
      { content_job_id: 'a', status: 'error' },
      { content_job_id: 'a', status: 'error' },
      { content_job_id: 'b', status: 'pending' },
      { content_job_id: 'c', status: 'drafting' },
      { content_job_id: 'c', status: 'pending' },
    ])
    expect(plan).toEqual([
      { jobId: 'a', endpoint: 'retry' },
      { jobId: 'b', endpoint: 'run' },
    ])
  })

  it('caps how many jobs one sweep tick fans out to', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ content_job_id: `j${i}`, status: 'pending' }))
    expect(resumePlan(rows, 5)).toHaveLength(5)
  })
})
