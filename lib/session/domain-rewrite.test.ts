import { describe, expect, it } from 'vitest'
import { hostOf, rewriteHost } from './domain-rewrite'

describe('hostOf', () => {
  it('strips protocol, www, path, query, and lowercases', () => {
    expect(hostOf('https://www.RootAdvisors.com/team?x=1')).toBe('rootadvisors.com')
    expect(hostOf('rootadvisors.com')).toBe('rootadvisors.com')
    expect(hostOf('http://accordadvisors.com/')).toBe('accordadvisors.com')
  })
  it('handles empty/nullish', () => {
    expect(hostOf('')).toBe('')
    expect(hostOf(null)).toBe('')
    expect(hostOf(undefined)).toBe('')
  })
})

describe('rewriteHost', () => {
  it('rewrites bare and www hosts, case-insensitively', () => {
    expect(rewriteHost('Visit https://rootadvisors.com/tax', 'rootadvisors.com', 'accordadvisors.com'))
      .toBe('Visit https://accordadvisors.com/tax')
    expect(rewriteHost('mail@www.RootAdvisors.com', 'rootadvisors.com', 'accordadvisors.com'))
      .toBe('mail@accordadvisors.com')
  })
  it('is a no-op when hosts match or inputs are empty', () => {
    expect(rewriteHost('rootadvisors.com', 'rootadvisors.com', 'rootadvisors.com')).toBe('rootadvisors.com')
    expect(rewriteHost('', 'rootadvisors.com', 'accordadvisors.com')).toBe('')
  })
})
