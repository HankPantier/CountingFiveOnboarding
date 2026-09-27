import { describe, expect, it } from 'vitest'
import { isExpectedGithubRequestLog } from './app-client'

describe('isExpectedGithubRequestLog', () => {
  it('drops 304 cache hits and 404 not-found request logs', () => {
    expect(isExpectedGithubRequestLog('GET /repos/o/r/git/ref/heads%2Fdraft - 304 with id ABDC:1:2 in 121ms')).toBe(true)
    expect(isExpectedGithubRequestLog('GET /repos/o/r/contents/content%2Fblog.json?ref=draft - 404 with id C87E:4CBD4 in 65ms')).toBe(true)
  })
  it('keeps real failures and other messages', () => {
    expect(isExpectedGithubRequestLog('PUT /repos/o/r/contents/x - 409 with id A:1 in 80ms')).toBe(false)
    expect(isExpectedGithubRequestLog('GET /repos/o/r - 500 with id A:1 in 80ms')).toBe(false)
    expect(isExpectedGithubRequestLog('GitHub primary rate limit on GET /x — giving up')).toBe(false)
    expect(isExpectedGithubRequestLog(new Error('boom'))).toBe(false)
  })
})
