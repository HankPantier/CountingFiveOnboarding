import { describe, expect, it } from 'vitest'
import { readRedirectWarnings, redirectWarningMessage } from './redirect-warnings'

describe('readRedirectWarnings', () => {
  it('reads string warnings, trimmed and de-duplicated', () => {
    expect(readRedirectWarnings({ redirectWarnings: [' /a has a real page ', '/a has a real page', 7, ''] })).toEqual([
      '/a has a real page',
    ])
  })
  it('is empty for a response without warnings', () => {
    expect(readRedirectWarnings({ commitSha: 'c' })).toEqual([])
    expect(readRedirectWarnings(null)).toEqual([])
    expect(readRedirectWarnings({ redirectWarnings: 'nope' })).toEqual([])
  })
})

describe('redirectWarningMessage', () => {
  it('is null with no warnings (nothing replaces the banner)', () => {
    expect(redirectWarningMessage('Saved', [])).toBeNull()
  })
  it('joins warnings from several moves into one banner, de-duplicated', () => {
    expect(redirectWarningMessage('Moved 2 of 2', ['/a has a real page.', '/a has a real page.', '/b has a real page.'])).toBe(
      'Moved 2 of 2. Redirect check: /a has a real page. /b has a real page.'
    )
  })
})
