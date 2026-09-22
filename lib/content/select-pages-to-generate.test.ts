import { describe, expect, it } from 'vitest'
import { selectPagesToGenerate, MAX_GENERATION_ATTEMPTS } from './content-generator'

const outlines = [
  { page_url: '/' },
  { page_url: '/about-us' },
  { page_url: '/services' },
  { page_url: '/industries/family-offices' },
]

describe('selectPagesToGenerate', () => {
  it('skips pages that already completed', () => {
    const todo = selectPagesToGenerate(outlines, [
      { page_url: '/about-us', generation_status: 'complete', generation_attempts: 1 },
    ])
    expect(todo.map(o => o.page_url)).not.toContain('/about-us')
    expect(todo).toHaveLength(3)
  })

  it('skips errored pages that have burned the attempt cap', () => {
    // The runaway this guards: the loop's only filter used to be `complete`, so a
    // terminally failed page was re-attempted by every restart and every cron
    // tick, pushing its counter far past the cap (seen at 10 and 15 vs a cap of 3).
    const todo = selectPagesToGenerate(outlines, [
      { page_url: '/', generation_status: 'error', generation_attempts: MAX_GENERATION_ATTEMPTS },
    ])
    expect(todo.map(o => o.page_url)).not.toContain('/')
  })

  it('still retries an errored page that is under the cap', () => {
    const todo = selectPagesToGenerate(outlines, [
      { page_url: '/', generation_status: 'error', generation_attempts: MAX_GENERATION_ATTEMPTS - 1 },
    ])
    expect(todo.map(o => o.page_url)).toContain('/')
  })

  it('treats a page with no row yet as work to do', () => {
    expect(selectPagesToGenerate(outlines, [])).toHaveLength(4)
  })

  it('treats a null attempts count as zero rather than skipping', () => {
    const todo = selectPagesToGenerate(outlines, [
      { page_url: '/', generation_status: 'error', generation_attempts: null },
    ])
    expect(todo.map(o => o.page_url)).toContain('/')
  })

  it('never skips a running page — the claim guard owns that race', () => {
    const todo = selectPagesToGenerate(outlines, [
      { page_url: '/services', generation_status: 'running', generation_attempts: 1 },
    ])
    expect(todo.map(o => o.page_url)).toContain('/services')
  })
})
