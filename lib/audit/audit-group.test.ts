import { describe, expect, it } from 'vitest'
import { isAuditGroup, mostAdvancedGroup, groupsBelow, AUDIT_GROUPS } from './audit-group'

describe('isAuditGroup', () => {
  it('accepts the three folders and rejects anything else', () => {
    expect(AUDIT_GROUPS.every(isAuditGroup)).toBe(true)
    expect(isAuditGroup('prospect')).toBe(true)
    expect(isAuditGroup('archived')).toBe(false)
    expect(isAuditGroup('')).toBe(false)
  })
})

describe('mostAdvancedGroup (inheritance)', () => {
  it('picks the furthest-along folder', () => {
    expect(mostAdvancedGroup(['prospect', 'client', 'working'])).toBe('client')
    expect(mostAdvancedGroup(['prospect', 'working'])).toBe('working')
    expect(mostAdvancedGroup(['prospect'])).toBe('prospect')
  })

  it('defaults to prospect for empty or unknown input', () => {
    expect(mostAdvancedGroup([])).toBe('prospect')
    expect(mostAdvancedGroup(['bogus', 'nope'])).toBe('prospect')
  })
})

describe('groupsBelow (forward-only promotion)', () => {
  it('only moves rows strictly below the target', () => {
    expect(groupsBelow('working')).toEqual(['prospect'])
    expect(groupsBelow('client')).toEqual(['prospect', 'working'])
  })

  it('promoting to prospect moves nothing (never downgrades)', () => {
    expect(groupsBelow('prospect')).toEqual([])
  })

  it("a 'working' promotion never touches an existing 'client'", () => {
    expect(groupsBelow('working')).not.toContain('client')
  })
})
