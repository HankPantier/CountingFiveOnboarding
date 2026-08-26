import { describe, it, expect } from 'vitest'
import { packageErrorMessage } from './package-error-message'

describe('packageErrorMessage', () => {
  it('returns the server-supplied error verbatim when present', () => {
    expect(packageErrorMessage(500, { error: 'Pages awaiting approval' })).toBe('Pages awaiting approval')
    // A real error wins even on a gateway status code.
    expect(packageErrorMessage(504, { error: 'Failed to upload package: EPIPE' })).toBe(
      'Failed to upload package: EPIPE'
    )
  })

  it('explains a bodyless timeout (504/502/503/0) instead of a generic failure', () => {
    for (const status of [0, 502, 503, 504]) {
      const msg = packageErrorMessage(status, {})
      expect(msg).toContain(`HTTP ${status}`)
      expect(msg).toContain('taking too long')
      expect(msg).not.toBe('Failed to assemble package')
    }
  })

  it('falls back to a status-tagged generic message for other bodyless failures', () => {
    expect(packageErrorMessage(500, {})).toBe('Failed to assemble package (HTTP 500)')
    expect(packageErrorMessage(400, null)).toBe('Failed to assemble package (HTTP 400)')
  })
})
