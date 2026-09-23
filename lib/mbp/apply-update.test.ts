import { describe, expect, it } from 'vitest'
import { toDottedPath } from './apply-update'

describe('toDottedPath', () => {
  it('normalizes bracket indices to the dotted form the MBP page keys on', () => {
    expect(toDottedPath('niches[3].description')).toBe('niches.3.description')
    expect(toDottedPath('team[0].certifications[2]')).toBe('team.0.certifications.2')
    expect(toDottedPath('business.tagline')).toBe('business.tagline')
  })
})
