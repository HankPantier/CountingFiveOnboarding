import { describe, expect, it } from 'vitest'
import { isStaleShaConflict, staleOtherFileMessage } from './conflict-response'

describe('isStaleShaConflict (EDIT-5 client side)', () => {
  it('is true only for a stale_sha body carrying the server sha and content', () => {
    expect(isStaleShaConflict({ error: 'stale_sha', currentSha: 's', currentContent: '{}' })).toBe(true)
    expect(isStaleShaConflict({ error: 'stale_sha', currentSha: '', currentContent: '' })).toBe(true)
  })

  it('is false for any other 409 (a different file went stale mid-save)', () => {
    expect(isStaleShaConflict({ error: 'content/redirects.csv changed while saving.' })).toBe(false)
    expect(isStaleShaConflict({ error: 'stale_sha' })).toBe(false)
    expect(isStaleShaConflict({})).toBe(false)
  })
})

describe('staleOtherFileMessage', () => {
  it('names the file that went stale: redirects.csv vs the page file', () => {
    expect(staleOtherFileMessage('content/redirects.csv')).toMatch(/^content\/redirects\.csv changed while saving/)
    expect(staleOtherFileMessage('content/pages/services--tax.md')).toMatch(/The page file content\/pages\/services--tax\.md changed/)
  })
})
