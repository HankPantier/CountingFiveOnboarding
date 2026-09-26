import { describe, expect, it } from 'vitest'
import { RequestError } from '@octokit/request-error'
import { githubErrorHint, githubErrorMessage } from './error-hint'

const reqErr = (status: number, message: string) =>
  new RequestError(message, status, { request: { method: 'POST', url: 'https://api.github.com', headers: {} } })

describe('githubErrorHint', () => {
  it('returns the curated permission hint without the raw Octokit text', () => {
    const hint = githubErrorHint(
      reqErr(403, 'Resource not accessible by integration - https://docs.github.com/rest/git/refs'),
      'cf/site'
    )
    expect(hint).toContain('Contents: Read & Write')
    expect(hint).not.toContain('docs.github.com')
    expect(hint).not.toContain('Resource not accessible')
  })

  it('returns the rate-limit hint', () => {
    expect(githubErrorHint(reqErr(403, 'API rate limit exceeded'), 'r')).toMatch(/rate limit/i)
  })

  it('returns null for anything else (callers fall back to a fixed message)', () => {
    expect(githubErrorHint(reqErr(422, 'Reference update failed - https://docs.github.com/x'), 'r')).toBeNull()
    expect(githubErrorHint(new Error('socket hang up'), 'r')).toBeNull()
  })

  it('githubErrorMessage (log-only) keeps the raw text for diagnosis', () => {
    expect(githubErrorMessage(new Error('socket hang up'), 'r')).toBe('socket hang up')
  })
})
