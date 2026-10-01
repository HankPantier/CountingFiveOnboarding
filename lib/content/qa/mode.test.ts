import { describe, it, expect } from 'vitest'
import { qaMode, qaOutstanding, QA_MAX_ATTEMPTS } from './mode'

describe('qaMode', () => {
  it('defaults to shadow when unset or unknown', () => {
    expect(qaMode({})).toBe('shadow')
    expect(qaMode({ CONTENT_QA_MODE: 'banana' })).toBe('shadow')
  })
  it('reads off / shadow / on case-insensitively', () => {
    expect(qaMode({ CONTENT_QA_MODE: 'OFF' })).toBe('off')
    expect(qaMode({ CONTENT_QA_MODE: 'on' })).toBe('on')
  })
})

describe('qaOutstanding', () => {
  const pages = [
    { generation_status: 'complete', qa_status: 'done' },
    { generation_status: 'complete', qa_status: 'running' },
  ]
  it('only gates in on mode', () => {
    expect(qaOutstanding(pages, 'on')).toBe(true)
    expect(qaOutstanding(pages, 'shadow')).toBe(false)
    expect(qaOutstanding(pages, 'off')).toBe(false)
  })
  it('ignores non-complete pages and terminal QA states', () => {
    expect(qaOutstanding([
      { generation_status: 'error', qa_status: 'queued' },
      { generation_status: 'complete', qa_status: 'skipped' },
      { generation_status: 'complete', qa_status: 'error', qa_attempts: QA_MAX_ATTEMPTS },
      { generation_status: 'complete', qa_status: null },
    ], 'on')).toBe(false)
  })
  it('treats a retriable QA error (attempts below the cap) as outstanding in on mode', () => {
    expect(qaOutstanding([{ generation_status: 'complete', qa_status: 'error', qa_attempts: 1 }], 'on')).toBe(true)
    expect(qaOutstanding([{ generation_status: 'complete', qa_status: 'error', qa_attempts: null }], 'on')).toBe(true)
    expect(qaOutstanding([{ generation_status: 'complete', qa_status: 'error', qa_attempts: QA_MAX_ATTEMPTS }], 'on')).toBe(false)
    expect(qaOutstanding([{ generation_status: 'complete', qa_status: 'error', qa_attempts: 1 }], 'shadow')).toBe(false)
  })
})
