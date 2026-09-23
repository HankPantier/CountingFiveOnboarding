import { describe, it, expect } from 'vitest'
import { resumePlan } from './resume-targets'
import { reconcileStuckTarget, MAX_BLOG_TARGET_ATTEMPTS } from './blog-batch-runner'

describe('resumePlan — attempt cap', () => {
  it('stops auto-retrying capped-out error rows (no endless /retry every tick)', () => {
    const rows = [{ content_job_id: 'j1', status: 'error', attempts: 3 }]
    expect(resumePlan(rows, 5, 3)).toEqual([])
  })

  it('still retries error rows under the cap', () => {
    const rows = [{ content_job_id: 'j1', status: 'error', attempts: 1 }]
    expect(resumePlan(rows, 5, 3)).toEqual([{ jobId: 'j1', endpoint: 'retry' }])
  })

  it('plans jobs in input (oldest-first) order so the limit rotates', () => {
    const rows = [
      { content_job_id: 'old', status: 'pending' },
      { content_job_id: 'new', status: 'pending' },
    ]
    expect(resumePlan(rows, 1).map(p => p.jobId)).toEqual(['old'])
  })
})

describe('reconcileStuckTarget', () => {
  it('marks a target complete when its idea already drafted (no blind re-draft)', () => {
    expect(reconcileStuckTarget('complete', 1)).toBe('complete')
  })
  it('leaves a target whose idea is still running', () => {
    expect(reconcileStuckTarget('running', 1)).toBe('leave')
  })
  it('retries under the cap and gives up at it', () => {
    expect(reconcileStuckTarget('error', 1)).toBe('pending')
    expect(reconcileStuckTarget('idle', MAX_BLOG_TARGET_ATTEMPTS)).toBe('error')
  })
})
